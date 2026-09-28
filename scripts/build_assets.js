import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const rootDir = process.cwd();

// 1. Create favicon.svg
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="8" fill="#0f766e"/>
  <text x="16" y="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5px">CM</text>
</svg>`;
fs.writeFileSync(path.join(rootDir, 'favicon.svg'), svg, 'utf8');

// 2. Generate a valid 32x32 PNG
function createPng32(rgbaPixels) {
  const width = 32;
  const height = 32;
  
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  
  // Table for CRC32
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) | 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crc = crc32(buf.subarray(4, 8 + len));
    buf.writeInt32BE(crc, 8 + len);
    return buf;
  }

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  
  const scanlineSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * scanlineSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const srcOffset = (y * width + x) * 4;
      rawData[pxOffset] = rgbaPixels[srcOffset];
      rawData[pxOffset + 1] = rgbaPixels[srcOffset + 1];
      rawData[pxOffset + 2] = rgbaPixels[srcOffset + 2];
      rawData[pxOffset + 3] = rgbaPixels[srcOffset + 3];
    }
  }
  
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const pixels = Buffer.alloc(32 * 32 * 4);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const idx = (y * 32 + x) * 4;
    const rx = Math.min(x, 31 - x);
    const ry = Math.min(y, 31 - y);
    let inside = true;
    if (rx < 6 && ry < 6) {
      const dx = 6 - rx;
      const dy = 6 - ry;
      if (dx * dx + dy * dy > 36) inside = false;
    }
    if (inside) {
      // Teal #0f766e
      pixels[idx] = 15;
      pixels[idx + 1] = 118;
      pixels[idx + 2] = 110;
      pixels[idx + 3] = 255;
      
      const isC = (x >= 8 && x <= 13 && (y === 10 || y === 11 || y === 21 || y === 22)) ||
                  (x >= 6 && x <= 8 && y >= 11 && y <= 21);
      const isM = ((x === 16 || x === 17 || x === 24 || x === 25) && (y >= 10 && y <= 22)) ||
                  (x >= 18 && x <= 20 && y >= 12 && y <= 15) ||
                  (x >= 21 && x <= 23 && y >= 12 && y <= 15) ||
                  (x === 20 && y === 16) || (x === 21 && y === 16);
      if (isC || isM) {
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
      }
    } else {
      pixels[idx] = 0;
      pixels[idx + 1] = 0;
      pixels[idx + 2] = 0;
      pixels[idx + 3] = 0;
    }
  }
}

const pngBuf = createPng32(pixels);
fs.writeFileSync(path.join(rootDir, 'favicon.png'), pngBuf);

// 3. Wrap PNG in valid ICO format
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type 1 = icon
icoHeader.writeUInt16LE(1, 4); // 1 image
icoHeader.writeUInt8(32, 6);   // width 32
icoHeader.writeUInt8(32, 7);   // height 32
icoHeader.writeUInt8(0, 8);    // colors (0 for 256+)
icoHeader.writeUInt8(0, 9);    // reserved
icoHeader.writeUInt16LE(1, 10); // planes
icoHeader.writeUInt16LE(32, 12); // bpp
icoHeader.writeUInt32LE(pngBuf.length, 14); // data size
icoHeader.writeUInt32LE(22, 18); // offset

const icoBuf = Buffer.concat([icoHeader, pngBuf]);
fs.writeFileSync(path.join(rootDir, 'favicon.ico'), icoBuf);

// 4. Copy social preview card to root
const artifactImg = 'C:\\Users\\ANIK HATUI\\.gemini\\antigravity-ide\\brain\\8706e782-8c84-4589-9b3f-951248d153fa\\og_preview_card_1790571421556.jpg';
if (fs.existsSync(artifactImg)) {
  fs.copyFileSync(artifactImg, path.join(rootDir, 'og-image.jpg'));
  console.log('Copied social preview card to og-image.jpg');
}

console.log('Favicon and social assets generated successfully.');
