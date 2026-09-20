import { fileURLToPath } from "node:url";

export const LICENSE_DIRECTORY = "licenses";

export const LICENSE_ASSETS = [
  {
    source: "LICENSE",
    destination: "licenses/PLVS-LICENSE.txt",
    markers: ["MIT License", "Copyright (c) 2026 SounDoer"],
  },
  {
    source: "THIRD-PARTY-NOTICES.md",
    destination: "licenses/THIRD-PARTY-NOTICES.txt",
    markers: ["FFmpeg 7.1 sidecars", "Silero VAD V5", "MPL-2.0"],
  },
  {
    source: "licenses/README.txt",
    destination: "licenses/README.txt",
    markers: ["PLVS LICENSE MATERIALS", "license-texts/"],
  },
  {
    source: "licenses/DEPENDENCY-INVENTORY.txt",
    destination: "licenses/DEPENDENCY-INVENTORY.txt",
    markers: [
      "PLVS PRODUCTION DEPENDENCY LICENSE INVENTORY",
      "RUST RUNTIME DEPENDENCIES (605)",
      "JAVASCRIPT PRODUCTION DEPENDENCIES (202)",
    ],
  },
  {
    source: "licenses/license-texts/0BSD.txt",
    destination: "licenses/license-texts/0BSD.txt",
    markers: ["Copyright (C) YEAR by AUTHOR EMAIL", "with or without fee"],
    sha256: "463e81654b73cc389902d72c4a0bcf0490b3809de5e0da2177fc12454a6fcf4d",
  },
  {
    source: "licenses/license-texts/Apache-2.0.txt",
    destination: "licenses/license-texts/Apache-2.0.txt",
    markers: ["Apache License", "Version 2.0, January 2004"],
    sha256: "1f83bfbb6ab612d244b9619bcf615e54c2e107fc78a05eb6e16bc1ce41fd2f8f",
  },
  {
    source: "licenses/license-texts/BSD-3-Clause.txt",
    destination: "licenses/license-texts/BSD-3-Clause.txt",
    markers: [
      "Redistribution and use in source and binary forms",
      "Neither the name of the copyright holder",
    ],
    sha256: "2fcaaa8d3d4c1be9b8f2dcb91e5c1609dc7a624ab9dc7bdb82fcf6402606c1d9",
  },
  {
    source: "licenses/license-texts/ISC.txt",
    destination: "licenses/license-texts/ISC.txt",
    markers: ["ISC License", "Permission to use, copy, modify"],
    sha256: "dba0c37b0f424384e8647e1c9175f12a90fc6be237f1a7b86431886034af52ca",
  },
  {
    source: "licenses/license-texts/LGPL-2.1-only.txt",
    destination: "licenses/license-texts/LGPL-2.1-only.txt",
    markers: ["GNU LESSER GENERAL PUBLIC LICENSE", "Version 2.1, February 1999"],
    sha256: "35312208d6b05fc255ed84abdf1ab0be2093caa91bee3d3c3ec6f1a0942ea3dc",
  },
  {
    source: "licenses/license-texts/MIT.txt",
    destination: "licenses/license-texts/MIT.txt",
    markers: ["MIT License", "Permission is hereby granted"],
    sha256: "9f420f8e43bbd65bddb84463a5f96db1f030fc7ecd4f0b35523b9610e8c3fa21",
  },
  {
    source: "licenses/license-texts/MPL-2.0.txt",
    destination: "licenses/license-texts/MPL-2.0.txt",
    markers: ["Mozilla Public License Version 2.0", "1. Definitions"],
    sha256: "1a389c0a135f37855baa2fb879f86ed111d7facf8b0d5188330b35a22c4428a1",
  },
  {
    source: "licenses/license-texts/Unicode-3.0.txt",
    destination: "licenses/license-texts/Unicode-3.0.txt",
    markers: ["UNICODE LICENSE V3", "Data Files or Software"],
    sha256: "cb69d4c76d7b5c55f4bb4ecff797ab6464f36289398aea28678b999b1112d857",
  },
  {
    source: "licenses/license-texts/Zlib.txt",
    destination: "licenses/license-texts/Zlib.txt",
    markers: ["zlib License", "This software is provided 'as-is'"],
    sha256: "4dfcff23dcece41557b99888c75f8fdfa53d013166e21ec60d35447d97acc580",
  },
];

export const TAURI_LICENSE_RESOURCES = {
  "../LICENSE": "licenses/PLVS-LICENSE.txt",
  "../THIRD-PARTY-NOTICES.md": "licenses/THIRD-PARTY-NOTICES.txt",
  "../licenses/README.txt": "licenses/README.txt",
  "../licenses/DEPENDENCY-INVENTORY.txt": "licenses/DEPENDENCY-INVENTORY.txt",
  "../licenses/license-texts/": "licenses/license-texts/",
};

export function isMain(importMetaUrl) {
  return (
    process.argv[1] &&
    fileURLToPath(importMetaUrl) === fileURLToPath(new URL(process.argv[1], "file:"))
  );
}
