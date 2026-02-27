/**
 * UUID v7 생성 유틸리티.
 *
 * 시간순 정렬 가능한 UUID v7을 외부 라이브러리 없이 생성.
 * RFC 9562 UUID v7 스펙을 따른다:
 *   - 상위 48비트: Unix timestamp (ms)
 *   - ver(4비트): 0111 (7)
 *   - rand_a(12비트): 랜덤
 *   - var(2비트): 10
 *   - rand_b(62비트): 랜덤
 *
 * Node.js 특정 API를 사용하지 않으며 브라우저에서도 동작한다.
 */

/**
 * 랜덤 바이트 배열을 생성한다.
 * crypto.getRandomValues가 사용 가능하면 이를 사용하고,
 * 그렇지 않으면 Math.random 폴백을 사용한다.
 */
function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const g = globalThis as Record<string, unknown>;
  const crypto = g.crypto as { getRandomValues?: (array: Uint8Array) => Uint8Array } | undefined;
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/** 바이트를 2자리 16진수 문자열로 변환 */
function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * UUID v7을 생성한다.
 *
 * 시간순 정렬이 가능하므로 이벤트 ID로 적합하다.
 * 동일 밀리초 내 호출 시에도 랜덤 비트로 고유성을 보장한다.
 *
 * @param timestamp - 밀리초 단위 Unix timestamp (기본값: Date.now())
 * @returns UUID v7 문자열 (예: "01912345-6789-7abc-8def-0123456789ab")
 */
export function generateEventId(timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  const rand = getRandomBytes(10);

  // 48-bit timestamp (ms) -> 6 bytes
  const tsBytes = new Uint8Array(6);
  tsBytes[0] = (ts / 2 ** 40) & 0xff;
  tsBytes[1] = (ts / 2 ** 32) & 0xff;
  tsBytes[2] = (ts / 2 ** 24) & 0xff;
  tsBytes[3] = (ts / 2 ** 16) & 0xff;
  tsBytes[4] = (ts / 2 ** 8) & 0xff;
  tsBytes[5] = ts & 0xff;

  // rand_a (12 bits) with version 7 (4 bits)
  // byte 6: version(0111) + rand_a high 4 bits
  const byte6 = 0x70 | (rand[0] & 0x0f);
  // byte 7: rand_a low 8 bits
  const byte7 = rand[1];

  // rand_b (62 bits) with variant 10 (2 bits)
  // byte 8: variant(10) + rand_b high 6 bits
  const byte8 = 0x80 | (rand[2] & 0x3f);
  // bytes 9-15: rand_b remaining 56 bits
  const byte9 = rand[3];
  const byte10 = rand[4];
  const byte11 = rand[5];
  const byte12 = rand[6];
  const byte13 = rand[7];
  const byte14 = rand[8];
  const byte15 = rand[9];

  return (
    byteToHex(tsBytes[0]) +
    byteToHex(tsBytes[1]) +
    byteToHex(tsBytes[2]) +
    byteToHex(tsBytes[3]) +
    '-' +
    byteToHex(tsBytes[4]) +
    byteToHex(tsBytes[5]) +
    '-' +
    byteToHex(byte6) +
    byteToHex(byte7) +
    '-' +
    byteToHex(byte8) +
    byteToHex(byte9) +
    '-' +
    byteToHex(byte10) +
    byteToHex(byte11) +
    byteToHex(byte12) +
    byteToHex(byte13) +
    byteToHex(byte14) +
    byteToHex(byte15)
  );
}

/**
 * UUID v7 문자열에서 타임스탬프를 추출한다.
 *
 * @param uuid - UUID v7 문자열
 * @returns 밀리초 단위 Unix timestamp
 */
export function extractTimestamp(uuid: string): number {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
