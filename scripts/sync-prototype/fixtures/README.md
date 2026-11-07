# Noise-C reference vector

`noise-c-xx.json` is the unmodified `Noise_XX_25519_ChaChaPoly_BLAKE2b` vector extracted and reformatted as JSON from [noise-c-basic.txt](https://github.com/rweather/noise-c/blob/master/tests/vector/noise-c-basic.txt), downloaded on 2026-10-30. No generator is run by the tests; they compare all three handshake messages, the handshake hash and all three bidirectional transport messages against these fixed expected bytes.

SHA-256 of the downloaded source bundle: `e826749cf90efda26be85410381f4b1f75552c61c7c0dcad7f9ffb4d639e4e45`.

SHA-256 of the extracted JSON fixture: `09142e9f78aeadaea75bbb4fa7b1504350ed2be1d023eaaf3a75cda95b4b9329`.

The deterministic private keys in this fixture are public test material. They must never be used outside tests.

Source project license, from [COPYING](https://github.com/rweather/noise-c/blob/master/COPYING):

Copyright (C) 2016 Southern Storm Software, Pty Ltd.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
