import { pathToFileURL } from "node:url";

import sharp from "sharp";

import {
  configureScenario,
  launchDesktopPerfRig,
  parseRigArgs,
  startLiveCapture,
  stopDesktopPerfRig,
} from "./desktop-perf-rig.mjs";
import { readUiFrameDiagnostics, wait } from "./webview-observability.mjs";

export const INSTALL_SURFACE_GL_PROBE = `(()=>{
  if(window.__PLVS_SURFACE_GL_PROBE__)return true;
  const proto=WebGL2RenderingContext.prototype;
  const original=proto.drawElements;
  const state={drawCalls:0,errors:[],drawState:null};
  proto.drawElements=function(mode,count,type,offset){
    const program=this.getParameter(this.CURRENT_PROGRAM);
    const location=program?this.getAttribLocation(program,"vertex"):-1;
    if(!state.drawState){
      const debug=this.getExtension("WEBGL_debug_renderer_info");
      state.drawState={
        renderer:debug?this.getParameter(debug.UNMASKED_RENDERER_WEBGL):this.getParameter(this.RENDERER),
        vertexLocation:location,
        vertexEnabled:location>=0?this.getVertexAttrib(location,this.VERTEX_ATTRIB_ARRAY_ENABLED):false,
        vertexSize:location>=0?this.getVertexAttrib(location,this.VERTEX_ATTRIB_ARRAY_SIZE):null,
        vertexType:location>=0?this.getVertexAttrib(location,this.VERTEX_ATTRIB_ARRAY_TYPE):null,
        vertexBufferBound:location>=0?!!this.getVertexAttrib(location,this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING):false,
        vertexArrayBound:!!this.getParameter(this.VERTEX_ARRAY_BINDING),
        indexBufferBound:!!this.getParameter(this.ELEMENT_ARRAY_BUFFER_BINDING),
        drawingBuffer:[this.drawingBufferWidth,this.drawingBufferHeight],count,type,offset};
    }
    const result=original.call(this,mode,count,type,offset);
    state.drawCalls++;
    const error=this.getError();
    if(error!==this.NO_ERROR)state.errors.push({drawCall:state.drawCalls,error});
    return result;
  };
  window.__PLVS_SURFACE_GL_PROBE__={snapshot:()=>structuredClone(state),stop(){proto.drawElements=original;}};
  return true;
})()`;

export async function compareCanvasScreenshots(first, second, canvas, threshold = 8) {
  const metadata = await sharp(first).metadata();
  const scaleX = metadata.width / canvas.viewport.width;
  const scaleY = metadata.height / canvas.viewport.height;
  const box = {
    left: Math.floor(canvas.rect.x * scaleX),
    top: Math.floor(canvas.rect.y * scaleY),
    width: Math.floor(canvas.rect.width * scaleX),
    height: Math.floor(canvas.rect.height * scaleY),
  };
  const crop = (image) => sharp(image).extract(box).removeAlpha().raw().toBuffer();
  const [a, b] = await Promise.all([crop(first), crop(second)]);
  let changedPixels = 0;
  const totalPixels = a.length / 3;
  for (let index = 0; index < a.length; index += 3) {
    if (
      Math.max(
        Math.abs(a[index] - b[index]),
        Math.abs(a[index + 1] - b[index + 1]),
        Math.abs(a[index + 2] - b[index + 2])
      ) > threshold
    ) {
      changedPixels += 1;
    }
  }
  return {
    screenshotSize: [metadata.width, metadata.height],
    crop: box,
    changedPixels,
    totalPixels,
    changedPct: (100 * changedPixels) / Math.max(1, totalPixels),
  };
}

export async function diagnoseSurfaceFallback(options, log = console.log) {
  const rig = await launchDesktopPerfRig(options);
  try {
    const layout = await configureScenario(rig.session, options.scenario);
    await rig.session.evaluate(INSTALL_SURFACE_GL_PROBE);
    const device = await startLiveCapture(rig.session, options.device);
    log(`Surface fallback diagnostic: ${options.seconds}s on ${device}`);
    await wait(options.seconds * 1_000);
    const firstCapture = await rig.session.send("Page.captureScreenshot", { format: "png" });
    await wait(3_000);
    const secondCapture = await rig.session.send("Page.captureScreenshot", { format: "png" });
    const [probe, ui, canvas] = await Promise.all([
      rig.session.evaluate("window.__PLVS_SURFACE_GL_PROBE__.snapshot()"),
      readUiFrameDiagnostics(rig.session),
      rig.session
        .evaluate(`(()=>{const c=document.querySelector("canvas[data-spectrogram-gl]");const r=c?.getBoundingClientRect();return c?{
        width:c.width,height:c.height,clientWidth:c.clientWidth,clientHeight:c.clientHeight,
        rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},
        contextLost:c.getContext("webgl2").isContextLost()}:null;})()`),
    ]);
    const composite = await compareCanvasScreenshots(
      Buffer.from(firstCapture.data, "base64"),
      Buffer.from(secondCapture.data, "base64"),
      canvas
    );
    const result = { layout, device, canvas, ui, probe, composite };
    log(JSON.stringify(result, null, 2));
    if (probe.drawCalls === 0) throw new Error("Surface issued no WebGL draw calls");
    if (probe.errors.length > 0) throw new Error("Surface emitted WebGL errors");
    if (composite.changedPct < 0.05) {
      throw new Error(
        `composited Surface changed only ${composite.changedPct.toFixed(3)}% of pixels`
      );
    }
    return result;
  } finally {
    await rig.session?.evaluate("window.__PLVS_SURFACE_GL_PROBE__?.stop()").catch(() => {});
    await stopDesktopPerfRig(rig);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const options = parseRigArgs(process.argv.slice(2), {
    scenario: "heavy",
    seconds: 15,
    browserArgs: "--disable-gpu",
  });
  diagnoseSurfaceFallback(options).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
