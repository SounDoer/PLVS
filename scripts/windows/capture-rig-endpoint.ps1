param(
    [Parameter(Mandatory)] [ValidateSet("snapshot", "disconnect", "restore")] [string] $Action,
    [Parameter(Mandatory)] [string] $StateFile
)
$ErrorActionPreference = "Stop"

# Only the VB-Cable capture endpoint is in scope. Do not disable the adapter, the render
# endpoint or any other recording endpoint. Recheck the identity before each mutation.
$capture = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture"
$nameProperty = "{a45c254e-df1c-4efd-8020-67d146a850e0},2"
$cable = @(Get-ChildItem $capture | Where-Object {
    (Get-ItemPropertyValue (Join-Path $_.PSPath "Properties") -Name $nameProperty -ErrorAction SilentlyContinue) -eq "CABLE Output"
})
if ($cable.Count -ne 1 -or $cable[0].PSChildName -notmatch '^\{[a-fA-F0-9-]{36}\}$') {
    throw "Expected one VB-Cable recording endpoint with a valid ID."
}
$endpoint = "{0.0.1.00000000}.$($cable[0].PSChildName)"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CaptureRigEndpoint {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator {}
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDeviceEnumerator {
        void EnumAudioEndpoints();
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
        void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevice {
        void Activate();
        void OpenPropertyStore();
        void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        void GetState(out int state);
    }

    // The desktop's endpoint policy client implements the recording-device visibility
    // toggle used by Sound settings. Unused methods retain the native vtable slot order.
    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    private class PolicyConfigClient {}
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig {
        void GetMixFormat();
        void GetDeviceFormat();
        void ResetDeviceFormat();
        void SetDeviceFormat();
        void GetProcessingPeriod();
        void SetProcessingPeriod();
        void GetShareMode();
        void SetShareMode();
        void GetPropertyValue();
        void SetPropertyValue();
        void SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        void SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }

    public static int GetState(string id) {
        IDevice device;
        ((IDeviceEnumerator)new MMDeviceEnumerator()).GetDevice(id, out device);
        int state;
        device.GetState(out state);
        return state;
    }

    public static string DefaultCapture(int role) {
        IDevice device;
        int result = ((IDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(1, role, out device);
        if (result == unchecked((int)0x80070490)) return null;
        Marshal.ThrowExceptionForHR(result);
        string id;
        device.GetId(out id);
        return id;
    }

    public static void SetVisible(string id, bool visible) {
        ((IPolicyConfig)new PolicyConfigClient()).SetEndpointVisibility(id, visible ? 1 : 0);
    }

    public static void RestoreDefault(string id, int role) {
        if (!String.Equals(DefaultCapture(role), id, StringComparison.OrdinalIgnoreCase))
            ((IPolicyConfig)new PolicyConfigClient()).SetDefaultEndpoint(id, role);
    }
}
'@

if ($Action -eq "snapshot") {
    if ([CaptureRigEndpoint]::GetState($endpoint) -ne 1) {
        throw "The VB-Cable recording endpoint must be active before the scenario."
    }
    $roles = @(0..2 | Where-Object { [CaptureRigEndpoint]::DefaultCapture($_) -eq $endpoint })
    @{ endpoint = $endpoint; defaultRoles = $roles } |
        ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath $StateFile
    return
}

$original = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
if ($original.endpoint -ne $endpoint -or @($original.defaultRoles | Where-Object { $_ -notin 0, 1, 2 }).Count) {
    throw "The saved recording endpoint state does not match the VB-Cable rig."
}
$restore = $Action -eq "restore"
$wanted = if ($restore) { 1 } else { 2 }
if ([CaptureRigEndpoint]::GetState($endpoint) -ne $wanted) {
    [CaptureRigEndpoint]::SetVisible($endpoint, $restore)
}
for ($attempt = 0; $attempt -lt 40 -and [CaptureRigEndpoint]::GetState($endpoint) -ne $wanted; $attempt++) {
    Start-Sleep -Milliseconds 250
}
if ([CaptureRigEndpoint]::GetState($endpoint) -ne $wanted) {
    throw "The VB-Cable recording endpoint did not report the requested state."
}
if ($restore) {
    foreach ($role in $original.defaultRoles) {
        [CaptureRigEndpoint]::RestoreDefault($endpoint, $role)
    }
    foreach ($role in $original.defaultRoles) {
        if ([CaptureRigEndpoint]::DefaultCapture($role) -ne $endpoint) {
            throw "Could not restore the original default VB-Cable recording role."
        }
    }
}
