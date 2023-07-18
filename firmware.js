const SETTINGS_VER = [0xAA, 0x03];
const LAYOUT_VER = [0xAA, 0x03];
const NUM_SHOWS = 20;
const FLASH_SIZE_MB = 2;

const EEPROM_START = (0x10000000 + (FLASH_SIZE_MB*0x100000) - 4096);
const SETTINGS_OFFSET = 0;
const LAYOUT_OFFSET_UF2 = 256;
const LAYOUT_OFFSET_HEX = (0x7E00 - 16);

const FIRMWARE_URL_UF2 = "firmware/firmware.uf2";
const FIRMWARE_URL_HEX = "firmware/firmware.hex";
const OFFSETS = {
  magic1:    0,
  magic2:    4,
  flags:     8,
  address:   12,
  size:      16,
  blockno:   20,
  numblocks: 24,
  family:    28,
  data:      32,
  magic3:    508,
}


class UF2Chunk {
  constructor(data = null) {
    this.header = new DataView(new ArrayBuffer(32));
    this.trailer = new DataView(new ArrayBuffer(4));

    if (data != null) {
      let dataview = new DataView(data.buffer);
      this.magic1     = dataview.getUint32(OFFSETS.magic1,     true);
      this.magic2     = dataview.getUint32(OFFSETS.magic2,     true);
      this.flags      = dataview.getUint32(OFFSETS.flags,      true);
      this.address    = dataview.getUint32(OFFSETS.address,    true);
      this.size       = dataview.getUint32(OFFSETS.size,       true);
      this.blockno    = dataview.getUint32(OFFSETS.blockno,    true);
      this.numblocks  = dataview.getUint32(OFFSETS.numblocks,  true);
      this.family     = dataview.getUint32(OFFSETS.family,     true);
      this.magic3     = dataview.getUint32(OFFSETS.magic3,     true);
      this.data       = data.slice(OFFSETS.data, OFFSETS.data + 476);
    } else {
      this.magic1    = 0x0A324655;
      this.magic2    = 0x9E5D5157;
      this.flags     = 0x2000;
      this.address   = 0x0;
      this.size      = 256;
      this.blockno   = 0;
      this.numblocks = 1;
      this.family    = 0xE48BFF56;
      this.magic3    = 0x0AB16F30;
      this.data      = new Uint8Array(476);
    }
  }

  getBlobData() {
    //                     offset               value             little endian
    this.header.setUint32(OFFSETS.magic1,       this.magic1,      true);
    this.header.setUint32(OFFSETS.magic2,       this.magic2,      true);
    this.header.setUint32(OFFSETS.flags,        this.flags,       true);
    this.header.setUint32(OFFSETS.address,      this.address,     true);
    this.header.setUint32(OFFSETS.size,         this.size,        true);
    this.header.setUint32(OFFSETS.blockno,      this.blockno,     true);
    this.header.setUint32(OFFSETS.numblocks,    this.numblocks,   true);
    this.header.setUint32(OFFSETS.family,       this.family,      true);
    this.trailer.setUint32(0,                   this.magic3,      true);

    return [this.header.buffer, this.data, this.trailer.buffer];
  }
}


class Layout {
  constructor(
    wing, nose, fuse, tail, nav,
    wingRev, noseRev, fuseRev,
    tailRev, noseFuseJoined
  ) {
    this.data = new Uint8Array([
      LAYOUT_VER[1], LAYOUT_VER[0],
      wing, nose, fuse, tail, nav,
      wingRev, noseRev, fuseRev,
      tailRev, noseFuseJoined
    ]);
  }
}

class Settings {
  constructor(shows = null) {
    this.data = new Uint8Array(NUM_SHOWS + 3);
    this.data.set([SETTINGS_VER[1], SETTINGS_VER[0]], 0);
    if (shows != null) {
      this.data.set(shows, 2);
    }
  }
}

async function generateHex(layout, fullFirmware) {
  firmware = "";
  if (fullFirmware) {
    let response = await fetch(FIRMWARE_URL_HEX);
    let text = await response.text();
    firmware = text.substring(0, text.lastIndexOf(":"));
  }

  let data = [layout.data.length, ((LAYOUT_OFFSET_HEX >> 8) & 0xff), (LAYOUT_OFFSET_HEX & 0xff), 0];
  data = data.concat(Array.from(layout.data));
  let sum = data.reduce((a, b) => a + b, 0);
  data.push((~sum & 0xff) + 1);
  let output = ":";
  data.forEach((e) => output += e.toString(16).toUpperCase().padStart(2, "0"));

  firmware += output + "\r\n:00000001FF\r\n";

  return [firmware];
}

async function generateUF2(layout, settings, fullFirmware) {
  let layoutChunk = new UF2Chunk();
  layoutChunk.address = EEPROM_START + LAYOUT_OFFSET_UF2;
  layoutChunk.data.set(layout.data, 0);

  let settingsChunk = new UF2Chunk();
  settingsChunk.address = EEPROM_START + SETTINGS_OFFSET;
  settingsChunk.data.set(settings.data, 0);

  let firmware = [];

  let numBlocks = 2;

  if (fullFirmware) {
    let response = await fetch(FIRMWARE_URL_UF2);
    let data = new Uint8Array(await response.arrayBuffer());

    let chunk = new UF2Chunk(data.slice(0, 512));
    numBlocks += chunk.numblocks;

    chunk.numblocks = numBlocks;
    firmware.push(...chunk.getBlobData());

    for (let i = 512; i < data.length; i += 512) {
      let chunk = new UF2Chunk(data.slice(i, i+512));
      chunk.numblocks = numBlocks;
      firmware.push(...chunk.getBlobData());
    }
  }

  layoutChunk.blockno = numBlocks - 2;
  layoutChunk.numblocks = numBlocks;
  settingsChunk.blockno = numBlocks - 1;
  settingsChunk.numblocks = numBlocks;

  firmware.push(...layoutChunk.getBlobData());
  firmware.push(...settingsChunk.getBlobData());

  return firmware;
}


async function startDownload(layout, settings, firmwareType, version) {
  let link = document.createElement("a");
  let blob;

  switch (firmwareType) {
    case "v2Full":
      link.download = "firmware-config_v" + version + ".uf2";
      blob = new Blob(await generateUF2(layout, settings, true), {type: "application/octet-stream"});
      link.href = URL.createObjectURL(blob);
      break;
    case "v2Config":
      link.download = "config_v" + version + ".uf2";
      blob = new Blob(await generateUF2(layout, settings, false), {type: "application/octet-stream"});
      link.href = URL.createObjectURL(blob);
      break;
    case "v2Firmware":
      link.download = "firmware_v" + version + ".uf2";
      link.href = FIRMWARE_URL_UF2;
      break;

    case "v1Full":
      link.download = "firmware-config_v" + version + ".hex";
      blob = new Blob(await generateHex(layout, true), {type: "text/plain"});
      link.href = URL.createObjectURL(blob);
      break;
    case "v1Config":
      link.download = "config_v" + version + ".hex";
      blob = new Blob(await generateHex(layout, false), {type: "text/plain"});
      link.href = URL.createObjectURL(blob);
      break;
    case "v1Firmware":
      link.download = "firmware_v" + version + ".hex";
      link.href = FIRMWARE_URL_HEX;
      break;
  }
  
  link.click();
  URL.revokeObjectURL(blob);
}