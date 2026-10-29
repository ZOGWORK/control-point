// A streaming ZIP writer for the Prints library's folder and group downloads.
// Each entry is deflated straight from disk to the response with a data
// descriptor (sizes and CRC after the data), so a 2 GB folder never sits in
// memory. Names are UTF-8 (flag bit 11). No ZIP64: callers keep the total
// under ZIP_MAX_BYTES.
import { createReadStream } from "node:fs";
import { createDeflateRaw } from "node:zlib";
import type { Writable } from "node:stream";

/** Classic ZIP offsets are 32-bit; stay well under 4 GiB (deflate can grow incompressible data slightly). */
export const ZIP_MAX_BYTES = 3.5 * 1024 ** 3;
/** Classic ZIP counts entries in 16 bits. */
export const ZIP_MAX_ENTRIES = 65_535;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive, "/"-separated; every segment already a safe name. */
  name: string;
  /** File on disk. */
  path: string;
  mtime: Date;
}

/** Write a ZIP of `entries` to `out`, honouring backpressure. Rejects if `out` closes early or a file can't be read. */
export async function writeZip(out: Writable, entries: ZipEntry[]): Promise<void> {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error("too many entries for a classic ZIP");
  let offset = 0;
  const write = (buf: Buffer) => new Promise<void>((resolve, reject) => {
    if (out.destroyed || (out as any).writableEnded) return reject(new Error("closed"));
    offset += buf.length;
    if (out.write(buf)) return resolve();
    const done = (err?: Error) => { out.off("drain", ok); out.off("close", closed); err ? reject(err) : resolve(); };
    const ok = () => done();
    const closed = () => done(new Error("closed"));
    out.once("drain", ok);
    out.once("close", closed);
  });
  const central: Buffer[] = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const { time, date } = dosTime(e.mtime);
    const start = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    await write(Buffer.concat([local, name]));
    let crc = 0, usize = 0, csize = 0;
    const src = createReadStream(e.path);
    const deflate = createDeflateRaw({ level: 6 });
    src.on("data", (c: Buffer | string) => { const b = typeof c === "string" ? Buffer.from(c) : c; crc = crc32(b, crc); usize += b.length; });
    src.on("error", (err) => deflate.destroy(err));
    src.pipe(deflate);
    try {
      for await (const chunk of deflate) { csize += (chunk as Buffer).length; await write(chunk as Buffer); }
    } finally { src.destroy(); }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc, 4);
    desc.writeUInt32LE(csize, 8);
    desc.writeUInt32LE(usize, 12);
    await write(desc);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0808, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(csize, 20);
    c.writeUInt32LE(usize, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(start, 42);
    central.push(c, name);
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  await write(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
}

/** Archive paths made unique ("a.stl", "a (2).stl"), case-insensitively, as every OS will unpack them. */
export function uniqueZipNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((n) => {
    let out = n;
    const dot = n.lastIndexOf(".");
    const slash = n.lastIndexOf("/");
    const [stem, ext] = dot > slash + 1 ? [n.slice(0, dot), n.slice(dot)] : [n, ""];
    for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${stem} (${i})${ext}`;
    taken.add(out.toLowerCase());
    return out;
  });
}
