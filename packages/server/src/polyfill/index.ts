/* oxlint-disable unicorn/no-new-buffer */
if (typeof Buffer === 'undefined') {
    // oxlint-disable-next-line typescript/ban-ts-comment
    // @ts-expect-error
    globalThis.Buffer = class Buffer extends ArrayBuffer {
        constructor(bufferOrLength: ArrayBuffer | number) {
            if (bufferOrLength instanceof ArrayBuffer) {
                super(bufferOrLength.byteLength);
                new Uint8Array(this).set(new Uint8Array(bufferOrLength));
            } else {
                super(bufferOrLength);
            }
        }

        static from(data: any, encoding: string): Buffer {
            if (typeof data === 'string') {
                const encoder = new TextEncoder();
                // `TextEncoder.encode` always allocates a fresh ArrayBuffer, but
                // `Uint8Array.buffer` is typed as the wider ArrayBufferLike.
                return new Buffer(encoder.encode(data).buffer as ArrayBuffer);
            }
            if (data instanceof ArrayBuffer) {
                return new Buffer(data);
            }
            if (data instanceof Uint8Array) {
                const buffer = new ArrayBuffer(data.byteLength);
                new Uint8Array(buffer).set(data);
                return new Buffer(buffer);
            }
            throw new Error(`Unsupported data type: ${typeof data}, encoding: ${encoding}`);
        }

        toString(encoding: string): string {
            switch (encoding) {
                case 'hex':
                    return Array.from(new Uint8Array(this))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                case 'base64':
                    return btoa(String.fromCharCode.apply(null, new Uint8Array(this) as unknown as number[]));
                default:
                    return new TextDecoder(encoding).decode(new Uint8Array(this));
            }
        }
    };
}
