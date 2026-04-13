/**
 * Client-side Star ASB (Automatic Status Back) parser.
 *
 * Parses the raw hex-encoded ASB response bytes sent by bridges in the
 * `rawStatus` field.  This allows the ReceiptKit dashboard to re-derive
 * printer status client-side, decoupling status display accuracy from
 * bridge software version.
 *
 * The parser handles two frame layouts:
 *   - **Headed** (mC-Print series): byte 0 bit 0 = 1, 2-byte header,
 *     contiguous status at offsets 2–7.
 *   - **Headerless** (TSP series): byte 0 bit 0 = 0, 7 contiguous
 *     status bytes starting at offset 0.
 *
 * Status byte layout (contiguous, relative to first status byte):
 *   sb0: cover open (0x20), offline (0x08)
 *   sb1: over temp (0x40), unrecoverable (0x20), cutter (0x08), mech (0x04)
 *   sb2: jam (0x08), head up (0x02), voltage (0x01)
 *   sb3: paper empty (0x08), paper near end (0x04 inner | 0x02 outer)
 *   sb4: paper present
 *   sb5: ETB counter (bits 0–4)
 */

import type { LivePrinterStatus } from "./types";

/**
 * Parse a hex-encoded ASB response string into a LivePrinterStatus.
 *
 * @param rawHex - Space-separated hex bytes, e.g. "2f 8c 00 00 00 0c 00 00 ..."
 * @returns Parsed status, or null if the input is invalid / too short.
 */
export function parseRawAsb(rawHex: string): LivePrinterStatus | null {
  const bytes = hexToBytes(rawHex);
  if (!bytes || bytes.length < 7) return null;

  // Headed format: byte 0 bit 0 is set (mC-Print2/3, mC-Label3)
  const isHeaded = (bytes[0] & 0x01) !== 0;

  if (isHeaded && bytes.length >= 8) {
    return parseHeadedAsb(bytes);
  } else if (!isHeaded && bytes.length >= 7) {
    return parseStandardAsb(bytes);
  }

  return null;
}

/**
 * Parse headed ASB (2-byte header + contiguous status at offsets 2–7).
 */
function parseHeadedAsb(bytes: Uint8Array): LivePrinterStatus {
  const sb0 = bytes[2] ?? 0;
  const sb1 = bytes[3] ?? 0;
  const sb2 = bytes[4] ?? 0;
  const sb3 = bytes[5] ?? 0;
  const sb5 = bytes[7] ?? 0;

  // Presenter: byte 1 encodes 0x80 | data_count.
  // When data_count > 12 (i.e. 14+ data bytes), presenter bytes at offsets 12–15.
  const dataLen = (bytes[1] ?? 0) & 0x7f;
  const hasPresenter = dataLen > 12 && bytes.length > 15;

  let presenterCoverOpen = false;
  let presenterPaperJam = false;
  let receiptHeld = false;

  if (hasPresenter) {
    const presA = bytes[12]; // Presenter status byte A
    const presC = bytes[14]; // Presenter status byte C
    presenterCoverOpen = (presA & 0x20) !== 0;
    presenterPaperJam = (presA & 0x04) !== 0;
    receiptHeld = (presC & 0x08) !== 0;
  }

  return {
    online: true,
    coverOpen:          (sb0 & 0x20) !== 0,
    paperEmpty:         (sb3 & 0x08) !== 0,
    paperNearEnd:       (sb3 & 0x06) !== 0,
    cutterError:        (sb1 & 0x08) !== 0,
    mechError:          (sb1 & 0x04) !== 0,
    jamError:           (sb2 & 0x08) !== 0,
    overTemp:           (sb1 & 0x40) !== 0,
    headUpError:        (sb2 & 0x02) !== 0,
    voltageError:       (sb2 & 0x01) !== 0,
    etbCounter:         sb5 & 0x1f,
    lastCheck:          null, // Caller should preserve the original lastCheck
    hasPresenter,
    presenterCoverOpen,
    presenterPaperJam,
    receiptHeld,
  };
}

/**
 * Parse standard headerless 7-byte ASB (TSP series).
 */
function parseStandardAsb(bytes: Uint8Array): LivePrinterStatus {
  const sb0 = bytes[0];
  const sb1 = bytes[1];
  const sb2 = bytes[2];
  const sb3 = bytes[3];
  const sb5 = bytes[5] ?? 0;

  return {
    online: true,
    coverOpen:          (sb0 & 0x20) !== 0,
    paperEmpty:         (sb3 & 0x08) !== 0,
    paperNearEnd:       (sb3 & 0x06) !== 0,
    cutterError:        (sb1 & 0x08) !== 0,
    mechError:          (sb1 & 0x04) !== 0,
    jamError:           (sb2 & 0x08) !== 0,
    overTemp:           (sb1 & 0x40) !== 0,
    headUpError:        (sb2 & 0x02) !== 0,
    voltageError:       (sb2 & 0x01) !== 0,
    etbCounter:         sb5 & 0x1f,
    lastCheck:          null,
    hasPresenter:       false,
    presenterCoverOpen: false,
    presenterPaperJam:  false,
    receiptHeld:        false,
  };
}

/**
 * Convert a space-separated hex string to a Uint8Array.
 * Returns null if the string is empty or contains invalid hex.
 */
function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || typeof hex !== "string") return null;
  const parts = hex.trim().split(/\s+/);
  if (parts.length === 0) return null;

  const bytes = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const val = parseInt(parts[i], 16);
    if (isNaN(val)) return null;
    bytes[i] = val;
  }
  return bytes;
}
