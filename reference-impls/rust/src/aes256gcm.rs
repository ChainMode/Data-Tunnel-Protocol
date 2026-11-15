//! Self-contained, `#![forbid(unsafe_code)]` implementation of NIST FIPS 197 AES-256
//! and NIST SP 800-38D Galois/Counter Mode (AES-256-GCM) for DTP 1.0 wire payloads.
//!
//! Wire layout matches `DTPEncryptionModule` (`[12B IV][Ciphertext][16B AuthTag]`)
//! and is cross-verified against NIST test vectors and Node.js `node:crypto` vectors.

const SBOX: [u8; 256] = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

const RCON: [u32; 7] = [
    0x0100_0000,
    0x0200_0000,
    0x0400_0000,
    0x0800_0000,
    0x1000_0000,
    0x2000_0000,
    0x4000_0000,
];

pub const IV_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const KEY_LEN: usize = 32;

fn sub_word(w: u32) -> u32 {
    let b = w.to_be_bytes();
    u32::from_be_bytes([
        SBOX[b[0] as usize],
        SBOX[b[1] as usize],
        SBOX[b[2] as usize],
        SBOX[b[3] as usize],
    ])
}

fn rot_word(w: u32) -> u32 {
    w.rotate_left(8)
}

fn xtime(x: u8) -> u8 {
    let shifted = (x as u16) << 1;
    if (x & 0x80) != 0 {
        (shifted ^ 0x1b) as u8
    } else {
        shifted as u8
    }
}

/// NIST FIPS 197 AES-256 (Nk = 8, Nr = 14) single-block encryption cipher.
pub struct Aes256 {
    round_keys: [[u8; 16]; 15],
}

impl Aes256 {
    pub fn new(key: &[u8; KEY_LEN]) -> Self {
        let mut w = [0u32; 60];
        for i in 0..8 {
            w[i] = u32::from_be_bytes([
                key[4 * i],
                key[4 * i + 1],
                key[4 * i + 2],
                key[4 * i + 3],
            ]);
        }
        for i in 8..60 {
            let mut temp = w[i - 1];
            if i % 8 == 0 {
                temp = sub_word(rot_word(temp)) ^ RCON[(i / 8) - 1];
            } else if i % 8 == 4 {
                temp = sub_word(temp);
            }
            w[i] = w[i - 8] ^ temp;
        }

        let mut round_keys = [[0u8; 16]; 15];
        for r in 0..15 {
            for c in 0..4 {
                let bytes = w[r * 4 + c].to_be_bytes();
                round_keys[r][c * 4..c * 4 + 4].copy_from_slice(&bytes);
            }
        }
        Self { round_keys }
    }

    pub fn encrypt_block(&self, input: &[u8; 16]) -> [u8; 16] {
        let mut s = *input;
        add_round_key(&mut s, &self.round_keys[0]);

        for round in 1..14 {
            sub_bytes(&mut s);
            shift_rows(&mut s);
            mix_columns(&mut s);
            add_round_key(&mut s, &self.round_keys[round]);
        }

        sub_bytes(&mut s);
        shift_rows(&mut s);
        add_round_key(&mut s, &self.round_keys[14]);
        s
    }
}

fn add_round_key(state: &mut [u8; 16], rk: &[u8; 16]) {
    for i in 0..16 {
        state[i] ^= rk[i];
    }
}

fn sub_bytes(state: &mut [u8; 16]) {
    for b in state.iter_mut() {
        *b = SBOX[*b as usize];
    }
}

fn shift_rows(s: &mut [u8; 16]) {
    // Column-major AES state: s[row + 4 * col]
    let tmp = *s;
    // Row 1: left shift by 1
    s[1] = tmp[5];
    s[5] = tmp[9];
    s[9] = tmp[13];
    s[13] = tmp[1];
    // Row 2: left shift by 2
    s[2] = tmp[10];
    s[6] = tmp[14];
    s[10] = tmp[2];
    s[14] = tmp[6];
    // Row 3: left shift by 3
    s[3] = tmp[15];
    s[7] = tmp[3];
    s[11] = tmp[7];
    s[15] = tmp[11];
}

fn mix_columns(s: &mut [u8; 16]) {
    for c in 0..4 {
        let idx = c * 4;
        let a0 = s[idx];
        let a1 = s[idx + 1];
        let a2 = s[idx + 2];
        let a3 = s[idx + 3];
        let t = a0 ^ a1 ^ a2 ^ a3;
        s[idx] = a0 ^ t ^ xtime(a0 ^ a1);
        s[idx + 1] = a1 ^ t ^ xtime(a1 ^ a2);
        s[idx + 2] = a2 ^ t ^ xtime(a2 ^ a3);
        s[idx + 3] = a3 ^ t ^ xtime(a3 ^ a0);
    }
}

/// NIST SP 800-38D Algorithm 1: GF(2^128) multiplication with R = 0xe1 || 0^120.
fn gf128_mul(x: u128, y: u128) -> u128 {
    const R: u128 = 0xe100_0000_0000_0000_0000_0000_0000_0000;
    let mut z: u128 = 0;
    let mut v: u128 = y;
    for i in 0..128 {
        if ((x >> (127 - i)) & 1) == 1 {
            z ^= v;
        }
        if (v & 1) == 0 {
            v >>= 1;
        } else {
            v = (v >> 1) ^ R;
        }
    }
    z
}

fn ghash(h: u128, aad: &[u8], ciphertext: &[u8]) -> [u8; 16] {
    let mut y: u128 = 0;

    for chunk in aad.chunks(16) {
        let mut block = [0u8; 16];
        block[..chunk.len()].copy_from_slice(chunk);
        y = gf128_mul(y ^ u128::from_be_bytes(block), h);
    }

    for chunk in ciphertext.chunks(16) {
        let mut block = [0u8; 16];
        block[..chunk.len()].copy_from_slice(chunk);
        y = gf128_mul(y ^ u128::from_be_bytes(block), h);
    }

    let aad_bits = (aad.len() as u64) * 8;
    let ct_bits = (ciphertext.len() as u64) * 8;
    let mut len_block = [0u8; 16];
    len_block[..8].copy_from_slice(&aad_bits.to_be_bytes());
    len_block[8..].copy_from_slice(&ct_bits.to_be_bytes());
    y = gf128_mul(y ^ u128::from_be_bytes(len_block), h);

    y.to_be_bytes()
}

fn inc32(counter: &mut [u8; 16]) {
    let low = u32::from_be_bytes([counter[12], counter[13], counter[14], counter[15]]);
    let next = low.wrapping_add(1);
    counter[12..16].copy_from_slice(&next.to_be_bytes());
}

fn gctr(cipher: &Aes256, icb: &[u8; 16], input: &[u8]) -> Vec<u8> {
    if input.is_empty() {
        return Vec::new();
    }
    let mut cb = *icb;
    let mut out = Vec::with_capacity(input.len());
    for chunk in input.chunks(16) {
        let keystream = cipher.encrypt_block(&cb);
        for (b, k) in chunk.iter().zip(keystream.iter()) {
            out.push(b ^ k);
        }
        inc32(&mut cb);
    }
    out
}

/// Constant-time 16-byte authentication tag comparison.
fn constant_time_eq_16(a: &[u8; 16], b: &[u8; 16]) -> bool {
    let mut diff: u8 = 0;
    for i in 0..16 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Encrypt plaintext using AES-256-GCM with a 96-bit (12B) IV and empty AAD,
/// returning `[12B IV][Ciphertext][16B AuthTag]`.
pub fn encrypt_aes256_gcm(
    key: &[u8; KEY_LEN],
    iv: &[u8; IV_LEN],
    plaintext: &[u8],
) -> Vec<u8> {
    let cipher = Aes256::new(key);
    let h = u128::from_be_bytes(cipher.encrypt_block(&[0u8; 16]));

    let mut j0 = [0u8; 16];
    j0[..12].copy_from_slice(iv);
    j0[15] = 1;

    let mut icb = j0;
    inc32(&mut icb);
    let ciphertext = gctr(&cipher, &icb, plaintext);

    let s = ghash(h, &[], &ciphertext);
    let ej0 = cipher.encrypt_block(&j0);
    let mut tag = [0u8; TAG_LEN];
    for i in 0..TAG_LEN {
        tag[i] = ej0[i] ^ s[i];
    }

    let mut wire = Vec::with_capacity(IV_LEN + ciphertext.len() + TAG_LEN);
    wire.extend_from_slice(iv);
    wire.extend_from_slice(&ciphertext);
    wire.extend_from_slice(&tag);
    wire
}

/// Decrypt `[12B IV][Ciphertext][16B AuthTag]` using AES-256-GCM, returning `None`
/// if length < 28 bytes or authentication tag verification fails.
pub fn decrypt_aes256_gcm(key: &[u8; KEY_LEN], wire_payload: &[u8]) -> Option<Vec<u8>> {
    if wire_payload.len() < IV_LEN + TAG_LEN {
        return None;
    }

    let iv = &wire_payload[..IV_LEN];
    let ciphertext = &wire_payload[IV_LEN..wire_payload.len() - TAG_LEN];
    let mut received_tag = [0u8; TAG_LEN];
    received_tag.copy_from_slice(&wire_payload[wire_payload.len() - TAG_LEN..]);

    let cipher = Aes256::new(key);
    let h = u128::from_be_bytes(cipher.encrypt_block(&[0u8; 16]));

    let mut j0 = [0u8; 16];
    j0[..12].copy_from_slice(iv);
    j0[15] = 1;

    let s = ghash(h, &[], ciphertext);
    let ej0 = cipher.encrypt_block(&j0);
    let mut computed_tag = [0u8; TAG_LEN];
    for i in 0..TAG_LEN {
        computed_tag[i] = ej0[i] ^ s[i];
    }

    if !constant_time_eq_16(&computed_tag, &received_tag) {
        return None;
    }

    let mut icb = j0;
    inc32(&mut icb);
    Some(gctr(&cipher, &icb, ciphertext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nist_fips_197_appendix_c3_aes256_block() {
        let key: [u8; 32] = hex::decode(
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        )
        .unwrap()
        .try_into()
        .unwrap();
        let pt: [u8; 16] = hex::decode("00112233445566778899aabbccddeeff")
            .unwrap()
            .try_into()
            .unwrap();
        let expected_ct = "8ea2b7ca516745bfeafc49904b496089";

        let aes = Aes256::new(&key);
        let ct = aes.encrypt_block(&pt);
        assert_eq!(hex::encode(ct), expected_ct);
    }

    #[test]
    fn nist_sp_800_38d_test_case_13_and_14() {
        // Test Case 13: K = 0^256, IV = 0^96, P = empty -> T = 530f8afbc74536b9a963b4f1c4cb738b
        let key = [0u8; 32];
        let iv = [0u8; 12];
        let out13 = encrypt_aes256_gcm(&key, &iv, &[]);
        assert_eq!(out13.len(), 28);
        assert_eq!(hex::encode(&out13[12..]), "530f8afbc74536b9a963b4f1c4cb738b");
        assert_eq!(decrypt_aes256_gcm(&key, &out13).unwrap(), Vec::<u8>::new());

        // Test Case 14: K = 0^256, IV = 0^96, P = 0^128
        // C = cea7403d4d606b6e074ec5d3baf39d18, T = d0d1c8a799996bf0265b98b5d48ab919
        let pt14 = [0u8; 16];
        let out14 = encrypt_aes256_gcm(&key, &iv, &pt14);
        assert_eq!(hex::encode(&out14[12..28]), "cea7403d4d606b6e074ec5d3baf39d18");
        assert_eq!(hex::encode(&out14[28..]), "d0d1c8a799996bf0265b98b5d48ab919");
        assert_eq!(decrypt_aes256_gcm(&key, &out14).unwrap(), pt14.to_vec());

        // Tamper 1 bit in tag -> None
        let mut tampered = out14.clone();
        tampered[43] ^= 0x01;
        assert!(decrypt_aes256_gcm(&key, &tampered).is_none());
    }
}
