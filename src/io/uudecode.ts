const base64table =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64codes = [
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  62,
  255,
  255,
  255,
  63,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  255,
  255,
  255,
  0,
  255,
  255,
  255,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  255,
  255,
  255,
  255,
  255,
  255,
  26,
  27,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51,
];

export class uudecode {
  private bytesLeft = 0;

  public decode(image_node: any, size: number): string {
    let nodes = image_node.childNodes;
    let r = '';
    this.bytesLeft = size;

    let test = '';
    for (let i = 0; i < nodes.length; ++i) {
      let node = nodes[i];
      if (node.nodeName === '#text') {
        test += node.nodeValue;
        r += this.uuencode_base64(node.nodeValue);
      }
    }

    return r;
  }

  private isWhitespace(c: string) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
  }

  // UUode a single line
  private uuencode_base64(line: string) {
    let uustate: number = 0;
    let uuLineSize: number = 0;
    let data = [0, 0, 0, 0];
    let r = '';
    let decoded = [0, 0, 0];

    for (let i = 0; i < line.length; ++i) {
      let v = (line.charCodeAt(i) - 32) & 63;

      switch (uustate) {
        case 0: // We are awaiting the line count
          if (this.isWhitespace(line.substr(i, 1))) {
            break;
          }
          // Not whitespace, so must be the line count...
          uuLineSize = v;
          uustate++;
          break;
        case 1: // We are awating the 1st char in the four char set
        case 2: // We are awating the 2nd char in the four char set
        case 3: // We are awating the 3rd char in the four char set
          data[uustate - 1] = v;
          uustate++;
          break;

        case 4: // We are awating the 4th char in the four char set
          data[uustate - 1] = v;

          decoded[0] = (data[0] << 2) | (data[1] >> 4);
          decoded[1] = (data[1] << 4) | (data[2] >> 2);
          decoded[2] = (data[2] << 6) | data[3];

          if (this.bytesLeft >= 3) {
            // 3 or more byte left
            r += base64table[decoded[0] >> 2];
            r += base64table[((decoded[0] & 0x03) << 4) | (decoded[1] >> 4)];
            r += base64table[((decoded[1] & 0x0f) << 2) | (decoded[2] >> 6)];
            r += base64table[decoded[2] & 0x3f];
          } else if (this.bytesLeft == 2) {
            // 2 bytes left
            r += base64table[decoded[0] >> 2];
            r += base64table[((decoded[0] & 0x03) << 4) | (decoded[1] >> 4)];
            r += base64table[(decoded[1] & 0x0f) << 2];
            r += '=';
          } else if (this.bytesLeft == 1) {
            // 1 byte left
            r += base64table[decoded[0] >> 2];
            r += base64table[(decoded[0] & 0x03) << 4];
            r += '==';
          }
          this.bytesLeft -= 3;

          uuLineSize -= 3;
          if (uuLineSize <= 0) {
            uustate = 0;
          } else {
            uustate = 1;
          }
          break;
      }
    }
    return r;
  }

  public encode(imagedef: any, base64: string) {
    const start = base64.indexOf(',') + 1;

    let r = '\n';
    let missingOctets = base64.endsWith('==')
      ? 2
      : base64.endsWith('=')
      ? 1
      : 0;
    let n = base64.length - start;
    let size = 3 * (n / 4) - missingOctets;
    let lineOut = 0;
    let done = 0;
    for (let i = start; i < n + start; i += 4) {
      if (lineOut <= 0) {
        lineOut = Math.min(size - done, 45);
        r += this.ENC(lineOut);
      }

      let buffer =
        (this.getBase64Code(base64.charCodeAt(i)) << 18) |
        (this.getBase64Code(base64.charCodeAt(i + 1)) << 12) |
        (this.getBase64Code(base64.charCodeAt(i + 2)) << 6) |
        this.getBase64Code(base64.charCodeAt(i + 3));

      const i0 = buffer >> 16;
      const i1 = (buffer >> 8) & 0xff;
      const i2 = buffer & 0xff;

      r += this.ENC(i0 >> 2);
      r += this.ENC(((i0 << 4) & 48) | ((i1 >> 4) & 15));
      r += this.ENC(((i1 << 2) & 60) | ((i2 >> 6) & 3));
      r += this.ENC(i2 & 63);

      lineOut -= 3;
      done += 3;
      if (lineOut <= 0) {
        r += '\n';
      }
    }

    imagedef.appendChild('UUENCODE', r, {
      size: size,
    });
  }

  private ENC(c: number) {
    return String.fromCharCode((c & 63) + 32);
  }

  private getBase64Code(charCode: number) {
    if (charCode >= base64codes.length) {
      throw new Error('Unable to parse base64 string.');
    }
    const code = base64codes[charCode];
    if (code === 255) {
      throw new Error('Unable to parse base64 string.');
    }
    return code;
  }

  /*
	addTag(_T("UUENCODE"));
	addAttribute(_T("size"), size);
	closeOpenTag();
	m_child_data = true;
	SendString(_T("\r\n"));

	// Now send the data...
	size_t i = 0;
	while (i < size)
	{
		TCHAR c[256];

		// 1 (up to) 45 character line
		int line_size = min((int) (size - i), 45);
		int p = 0;
		r += this.ENC(line_size));

		while (line_size > 0)
		{
			int i0 = data[i];
			i++;

			int i1 = 0;
			if (i < size)
			{
				i1 = data[i];
				i++;
			}

			int i2 = 0;
			if (i < size)
			{
				i2 = data[i];
				i++;
			}

			// output one group of 3 bytes as 4 chars
			r += this.ENC( i0 >> 2 ));
			r += this.ENC( (i0 << 4) & 060 | (i1 >> 4) & 017 ));
			r += this.ENC( (i1 << 2) & 074 | (i2 >> 6) & 03 ));
			r += this.ENC( i2 & 077 ));

			line_size -= 3;
		}

		c[p++] = '\n';
		c[p++] = 0;

		SendString(makeString(c));*/

  /*
  export function bytesToBase64(bytes: Uint8Array) {
  let result = '',
    i,
    l = bytes.length;
  for (i = 2; i < l; i += 3) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
    result += base64abc[((bytes[i - 1] & 0x0f) << 2) | (bytes[i] >> 6)];
    result += base64abc[bytes[i] & 0x3f];
  }
  if (i === l + 1) {
    // 1 octet yet to write
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[(bytes[i - 2] & 0x03) << 4];
    result += '==';
  }
  if (i === l) {
    // 2 octets yet to write
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
    result += base64abc[(bytes[i - 1] & 0x0f) << 2];
    result += '=';
  }
  return result;
}
*/
}
