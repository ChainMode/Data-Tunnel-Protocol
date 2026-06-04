# Chapter 7 Security and Encryption

## 7.1 Security Model

A DTP implementation **MUST** provide end-to-end encryption. The security model **MUST** satisfy the following invariants:

1. Only the target iFay instance **MUST** be able to decrypt the received Payload.
2. The FayGer runtime environment **MUST NOT** access plaintext data under any circumstances.
3. Intermediate network nodes **MUST NOT** read the Payload plaintext.
4. The DTP implementation **MUST NOT** manage encryption keys on its own.

## 7.2 Encryption Scope

The encryption scope **MUST** be strictly limited to the Payload of the LogicalFrame.

### 7.2.1 Content That MUST Be Encrypted

The following data **MUST** be encrypted:

- The `payload` field of the LogicalFrame (i.e. the `data` field of a Fragment, and—when carried as a Frame—the contents of RequestFrame, ResponseFrame, and ControlFrame).

### 7.2.2 Content That MUST NOT Be Encrypted

The following data **MUST NOT** be encrypted, and **MUST** be transmitted in plaintext:

- The `header` of the LogicalFrame (including `protocolVersion`, `frameType`, `fragmentId`, `agreementId`, `originTimestamp`, `dagDependencies`, `encryptionMetadata`, and `sequenceNumber`).

The encryption metadata itself **MUST NOT** be encrypted, so that the receiver can determine the decryption parameters before decryption.

## 7.3 Key Management

### 7.3.1 Key Source

A DTP implementation **MUST** use the key pre-negotiated by CAP. Specifically:

1. CAP **MUST** complete identity authentication and key exchange during the connection establishment phase.
2. The DTP implementation **MUST** use the `sessionKey` provided by CAP for Payload encryption/decryption.
3. The DTP implementation **MUST NOT** generate, negotiate, or exchange encryption keys on its own.

### 7.3.2 CAPContext Interface

A DTP implementation **MUST** receive the context provided by CAP through the following interface:

```typescript
interface CAPContext {
  identity: string;
  sessionKey: Uint8Array;
  verified: boolean;
}
```

| Field | Normative Requirement |
|-------|------------------------|
| `identity` | **MUST** be the peer's identity identifier |
| `sessionKey` | **MUST** be the byte sequence of the session key negotiated by CAP |
| `verified` | **MUST** reflect the CAP verification status |

### 7.3.3 CAP Preconditions

A DTP implementation **MUST** verify the CAPContext before starting data transmission:

1. If `verified === false`, **MUST** refuse to send any data frame and return the `KEY_NOT_READY` error (2002).
2. If `sessionKey` is empty or has an invalid length, **MUST** return the `KEY_NOT_READY` error.
3. The transmission of negotiation frames (Request_Frame, Response_Frame) is **likewise** subject to this precondition.

## 7.4 Encryption Metadata

The frame header of every LogicalFrame **MUST** carry EncryptionMetadata:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

### 7.4.1 Algorithm Identifiers

The `algorithm` field **MUST** be the identifier string of the encryption algorithm. **SHOULD** use one of the following standardized names:

| Identifier | Algorithm | Status |
|------------|-----------|--------|
| `"AES-256-GCM"` | AES-256 in Galois/Counter Mode | **RECOMMENDED** |
| `"ChaCha20-Poly1305"` | ChaCha20 with Poly1305 | **RECOMMENDED** |
| `"AES-128-GCM"` | AES-128 in Galois/Counter Mode | **MAY** be used |

An implementation **MUST** support at least one of `AES-256-GCM` and `ChaCha20-Poly1305`. It is **RECOMMENDED** to support both for enhanced interoperability.

An implementation **MUST NOT** use:

- ECB mode (insecure)
- Unauthenticated encryption modes (CBC, CTR without MAC)
- Algorithms with known weaknesses (DES, 3DES, RC4)

### 7.4.2 Key Version Number

`keyVersion` **MUST** be a non-negative integer used to support key rotation:

1. When CAP triggers key rotation, the new key's `keyVersion` **MUST** be strictly greater than the previous version.
2. The receiver **MUST** select the corresponding decryption key based on `keyVersion`.
3. An implementation **SHOULD** retain at least one previous key version to support in-flight Fragments.

## 7.5 Encryption Round-Trip Consistency

An implementation **MUST** satisfy the following encryption round-trip consistency properties:

1. Encrypting and then decrypting using the **correct key** (matching the key used by the sender) **MUST** produce output byte-identical to the original Payload.
2. Decrypting using an **incorrect key** **MUST** fail and **MUST** return the `DECRYPTION_FAILED` error (2001).
3. On decryption failure, the implementation **MUST NOT** return partial decryption results or corrupted data.

## 7.6 Decryption on the Terminal Side

When the terminal acts as the receiver (data injection scenario):

1. The DTP_Slave **MUST** use the key submitted by the terminal during the CAP connection establishment phase for decryption.
2. That key **MUST** correspond to the private key/session key the terminal submitted in CAP.
3. The terminal **MUST NOT** accept the decryption result of any other key.

## 7.7 Decryption Failure Handling

An implementation **MUST** handle decryption failures according to the following rules:

1. Single decryption failure: discard the frame and send the `DECRYPTION_FAILED` error notification (2001).
2. Consecutive decryption failures exceeding a threshold (implementation-defined, **RECOMMENDED** as 3):
   a. **SHOULD** trigger CAP to re-negotiate keys.
   b. **SHOULD** notify the upper-layer application of a security anomaly.
3. The implementation **MUST NOT** retry the same frame indefinitely after multiple decryption failures.

## 7.8 Security Threat Mitigation

An implementation **MUST** mitigate the following threats through protocol design:

| Threat | Mitigation Mechanism |
|--------|----------------------|
| Man-in-the-middle eavesdropping | End-to-end Payload encryption |
| FayGer snooping | Payload encryption; FayGer can only see ciphertext |
| Key leakage | Key version mechanism supports key rotation |
| Identity spoofing | Delegated to CAP for verification |
| Replay attacks | Monotonically increasing sequence numbers + Session binding |
| Frame tampering | Authenticated encryption (AEAD) algorithms |

## 7.9 Replay Protection

An implementation **MUST** mitigate replay attacks through the following mechanisms:

1. **Monotonically increasing sequence numbers**: The receiver **MUST** reject frames whose sequence number is less than or equal to the highest acknowledged sequence number (except in resume scenarios).
2. **Session binding**: The sequence number space **MUST** be bound to a specific Session. A new Session **MUST** reset the sequence number.
3. **AEAD authentication**: The encryption algorithm **MUST** provide message authentication (GCM, Poly1305, etc.).

## 7.10 Metadata Privacy

An implementation **SHOULD** be aware that the plaintext metadata in the frame header **MAY** leak the following information:

- Communication peer identities (correlated via `agreementId`)
- Communication time patterns (via `originTimestamp` and `sequenceNumber`)
- Data transmission frequency (via inter-frame timing)

An implementation **MAY** enhance metadata privacy through:

1. Enabling traffic padding (implementation-defined).
2. Using an obfuscation transport layer (e.g. ECH based on TLS 1.3).

However, this specification does **NOT REQUIRE** an implementation to provide metadata privacy protection.
