import { describe, it, expect } from 'vitest';
import { checkUploadContent, sniffFileKind, isPrivateStorageKey, safeExtension } from './uploadGuard';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]);

describe('checkUploadContent', () => {
  it('accepts real files whose bytes match their extension', () => {
    expect(checkUploadContent('a.jpg', JPEG).ok).toBe(true);
    expect(checkUploadContent('a.JPEG', JPEG).ok).toBe(true);
    expect(checkUploadContent('a.png', PNG).ok).toBe(true);
    expect(checkUploadContent('a.webp', WEBP).ok).toBe(true);
    expect(checkUploadContent('a.pdf', PDF).ok).toBe(true);
    expect(checkUploadContent('a.mp4', MP4).ok).toBe(true);
    expect(checkUploadContent('a.mov', MP4).ok).toBe(true);
  });

  it('rejects HTML/SVG disguised with an image extension or mimetype', () => {
    expect(checkUploadContent('evil.png', HTML).ok).toBe(false);
    expect(checkUploadContent('evil.jpg', SVG).ok).toBe(false);
  });

  it('rejects dangerous extensions outright, even with valid-looking content', () => {
    for (const name of ['x.html', 'x.svg', 'x.php', 'x.js', 'x.exe', 'x', 'x.htm', 'x.shtml']) {
      expect(checkUploadContent(name, JPEG).ok).toBe(false);
    }
  });

  it('rejects a mismatch between extension and content type', () => {
    expect(checkUploadContent('a.png', JPEG).ok).toBe(false);
    expect(checkUploadContent('a.pdf', PNG).ok).toBe(false);
  });

  it('rejects empty / truncated files', () => {
    expect(checkUploadContent('a.jpg', Buffer.alloc(0)).ok).toBe(false);
    expect(sniffFileKind(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('isPrivateStorageKey', () => {
  it('flags KYC, documents and temp prefixes in any form', () => {
    expect(isPrivateStorageKey('kyc/abc.jpg')).toBe(true);
    expect(isPrivateStorageKey('KYC/abc.jpg')).toBe(true);
    expect(isPrivateStorageKey('/documents/abc.pdf')).toBe(true);
  });
  it('keeps temp/ and search-temp/ reachable (photo-search worker, moderation fallback)', () => {
    expect(isPrivateStorageKey('temp/abc.jpg')).toBe(false);
    expect(isPrivateStorageKey('search-temp/abc.jpg')).toBe(false);
  });
  it('leaves public listing/media keys alone', () => {
    expect(isPrivateStorageKey('UGANDA/electronics/abc.jpg')).toBe(false);
    expect(isPrivateStorageKey('media/hero/abc.jpg')).toBe(false);
    expect(isPrivateStorageKey('abc.jpg')).toBe(false);
    expect(isPrivateStorageKey('kycfoo/abc.jpg')).toBe(false);
  });
});

describe('safeExtension', () => {
  it('keeps recognised extensions, lower-cased', () => {
    expect(safeExtension('Photo.JPG', 'image/jpeg')).toBe('.jpg');
    expect(safeExtension('x.jfif', 'image/jpeg')).toBe('.jfif');
  });
  it('replaces dangerous or missing extensions with the one implied by the mimetype', () => {
    expect(safeExtension('evil.html', 'image/png')).toBe('.png');
    expect(safeExtension('evil.svg', 'image/jpeg')).toBe('.jpg');
    expect(safeExtension('noextension', 'image/webp')).toBe('.webp');
  });
  it('falls back to .bin (rejected later) for unknown mimetypes', () => {
    expect(safeExtension('x.php', 'application/x-php')).toBe('.bin');
    expect(checkUploadContent('x.bin', Buffer.from([0xff, 0xd8, 0xff, 0xe0])).ok).toBe(false);
  });
});
