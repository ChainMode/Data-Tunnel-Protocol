#![forbid(unsafe_code)]
//! Independent Rust Reference Implementation of Data Tunnel Protocol (DTP) 1.0.
//!
//! Implements the normative DTP 1.0 wire envelope (`OQ-DTP-7`):
//! `[4B big-endian uint32 header byte length][RFC 8785 JCS UTF-8 FrameHeader][12B IV + AES-256-GCM ciphertext + 16B AuthTag]`,
//! single-MAJOR compatibility (`OQ-DTP-2`), Master/Slave/Observer RBAC, Agreement batch compression
//! & expiration (`OQ-DTP-6`, `OQ-DTP-11`), DAG acyclicity & out-of-order resolution, and bounded
//! exponential-backoff retransmission (`OQ-DTP-11`).

pub mod aes256gcm;
pub mod jcs;

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::aes256gcm::{decrypt_aes256_gcm, encrypt_aes256_gcm, IV_LEN, KEY_LEN};
use crate::jcs::canonicalize_json_value;

pub const CURRENT_MAJOR_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum DtpErrorCode {
    FrameDeserializationFailed = 1001,
    FrameInvalidFormat = 1002,
    DecryptionFailed = 2001,
    KeyNotReady = 2002,
    AgreementNotFound = 3001,
    AgreementExpired = 3002,
    AgreementNegotiationFailed = 3003,
    DagCycleDetected = 4001,
    DagDependencyUnresolved = 4002,
    SessionNotFound = 5001,
    SessionTimeout = 5002,
    SessionRestoreFailed = 5003,
    BufferFull = 6001,
    RetransmissionTimeout = 6002,
    VersionIncompatible = 7001,
    PermissionDenied = 8001,
    ObserverWriteDenied = 8002,
}

impl DtpErrorCode {
    pub fn as_u16(self) -> u16 {
        self as u16
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DtpError {
    pub code: DtpErrorCode,
    pub message: String,
}

impl DtpError {
    pub fn new(code: DtpErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: i64,
    pub minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameType {
    Data,
    Request,
    Response,
    Control,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DagRelationType {
    DerivedFrom,
    Annotates,
    Supersedes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagEdge {
    pub relation_type: DagRelationType,
    pub target_fragment_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionMetadata {
    pub algorithm: String,
    pub key_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameHeader {
    pub agreement_id: Option<String>,
    pub dag_dependencies: Vec<DagEdge>,
    pub encryption_metadata: EncryptionMetadata,
    pub fragment_id: String,
    pub frame_type: FrameType,
    pub origin_timestamp: u64,
    pub protocol_version: ProtocolVersion,
    pub sequence_number: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicalFrame {
    pub header: FrameHeader,
    pub payload: Vec<u8>,
}

/// Same-MAJOR compatibility check (`OQ-DTP-2`): only `major == 1` (`minor >= 0`) is compatible.
pub fn is_version_compatible(version: &ProtocolVersion) -> bool {
    version.major == CURRENT_MAJOR_VERSION as i64 && version.minor >= 0
}

/// Serialize a `LogicalFrame` into `[4B big-endian uint32 header_len][JCS UTF-8 header][payload]`.
pub fn serialize_frame(frame: &LogicalFrame) -> Result<Vec<u8>, DtpError> {
    let header_val = serde_json::to_value(&frame.header).map_err(|e| {
        DtpError::new(
            DtpErrorCode::FrameInvalidFormat,
            format!("header JSON conversion failed: {e}"),
        )
    })?;
    let jcs_str = canonicalize_json_value(&header_val);
    let header_bytes = jcs_str.as_bytes();
    let header_len: u32 = header_bytes.len().try_into().map_err(|_| {
        DtpError::new(
            DtpErrorCode::FrameInvalidFormat,
            "header exceeds u32 maximum length",
        )
    })?;

    let mut out = Vec::with_capacity(4 + header_bytes.len() + frame.payload.len());
    out.extend_from_slice(&header_len.to_be_bytes());
    out.extend_from_slice(header_bytes);
    out.extend_from_slice(&frame.payload);
    Ok(out)
}

/// Deserialize raw wire bytes into a `LogicalFrame` (`1001` on malformed prefix, invalid UTF-8, or missing required fields).
pub fn deserialize_frame(wire: &[u8]) -> Result<LogicalFrame, DtpError> {
    if wire.len() < 4 {
        return Err(DtpError::new(
            DtpErrorCode::FrameDeserializationFailed,
            "wire buffer shorter than 4-byte length prefix",
        ));
    }

    let header_len = u32::from_be_bytes([wire[0], wire[1], wire[2], wire[3]]) as usize;
    if header_len == 0 || wire.len() < 4 + header_len {
        return Err(DtpError::new(
            DtpErrorCode::FrameDeserializationFailed,
            "header length prefix overflows wire buffer",
        ));
    }

    let header_slice = &wire[4..4 + header_len];
    let header: FrameHeader = serde_json::from_slice(header_slice).map_err(|e| {
        DtpError::new(
            DtpErrorCode::FrameDeserializationFailed,
            format!("invalid FrameHeader JSON: {e}"),
        )
    })?;

    let payload = wire[4 + header_len..].to_vec();
    Ok(LogicalFrame { header, payload })
}

/// Full sender pipeline: encrypt plaintext with AES-256-GCM using explicit 12-byte IV and encode JCS wire frame.
pub fn encrypt_and_encode_frame(
    header: FrameHeader,
    plaintext: &[u8],
    session_key: &[u8; KEY_LEN],
    iv: &[u8; IV_LEN],
) -> Result<Vec<u8>, DtpError> {
    let encrypted_payload = encrypt_aes256_gcm(session_key, iv, plaintext);
    serialize_frame(&LogicalFrame {
        header,
        payload: encrypted_payload,
    })
}

/// Full receiver pipeline: decode wire frame (`1001`) -> verify same-MAJOR version (`7001`) -> decrypt AES-256-GCM (`2001`).
pub fn decode_and_decrypt_frame(
    wire: &[u8],
    session_key: &[u8; KEY_LEN],
) -> Result<(FrameHeader, Vec<u8>), DtpError> {
    let frame = deserialize_frame(wire)?;
    if !is_version_compatible(&frame.header.protocol_version) {
        return Err(DtpError::new(
            DtpErrorCode::VersionIncompatible,
            format!(
                "incompatible protocol major version: {}.{}",
                frame.header.protocol_version.major, frame.header.protocol_version.minor
            ),
        ));
    }

    if frame.header.frame_type == FrameType::Control
        && frame.header.encryption_metadata.algorithm == "none"
    {
        return Ok((frame.header, frame.payload));
    }

    let plaintext = decrypt_aes256_gcm(session_key, &frame.payload).ok_or_else(|| {
        DtpError::new(
            DtpErrorCode::DecryptionFailed,
            "AES-256-GCM authentication or decryption failed",
        )
    })?;
    Ok((frame.header, plaintext))
}

/// Role-based authority evaluation (`8001` / `8002`).
pub fn check_rbac(role: &str, action: &str) -> Result<(), DtpErrorCode> {
    match (role, action) {
        ("observer", _) => Err(DtpErrorCode::ObserverWriteDenied),
        ("master", "initiate_collection") | ("master", "send_frame") => Ok(()),
        ("master", "initiate_injection") => Err(DtpErrorCode::PermissionDenied),
        ("slave", "initiate_injection") | ("slave", "send_frame") => Ok(()),
        ("slave", "initiate_collection") => Err(DtpErrorCode::PermissionDenied),
        _ => Err(DtpErrorCode::PermissionDenied),
    }
}

/// Deterministic `Agreement_ID` batch compression & decompression (`OQ-DTP-6`).
pub fn compress_agreement_batch(
    frames: &[(FrameType, Option<String>)],
) -> Vec<(FrameType, Option<String>)> {
    let mut last_id: Option<String> = None;
    frames
        .iter()
        .map(|(ft, aid)| {
            if *ft != FrameType::Data {
                last_id = None;
                return (ft.clone(), aid.clone());
            }
            if aid.is_some() && *aid == last_id {
                return (ft.clone(), None);
            }
            last_id = aid.clone();
            (ft.clone(), aid.clone())
        })
        .collect()
}

pub fn decompress_agreement_batch(
    frames: &[(FrameType, Option<String>)],
) -> Result<Vec<(FrameType, Option<String>)>, DtpErrorCode> {
    let mut last_id: Option<String> = None;
    let mut out = Vec::with_capacity(frames.len());
    for (ft, aid) in frames {
        if *ft != FrameType::Data {
            last_id = None;
            out.push((ft.clone(), aid.clone()));
            continue;
        }
        match aid {
            Some(explicit) => {
                last_id = Some(explicit.clone());
                out.push((ft.clone(), Some(explicit.clone())));
            }
            None => match &last_id {
                Some(prev) => out.push((ft.clone(), Some(prev.clone()))),
                None => return Err(DtpErrorCode::AgreementNotFound),
            },
        }
    }
    Ok(out)
}

/// Check agreement validity window (`3002` when `now > created_at + validity_period`).
pub fn validate_agreement_expiry(
    created_at: u64,
    validity_period: u64,
    now: u64,
) -> Result<(), DtpErrorCode> {
    if now > created_at.saturating_add(validity_period) {
        Err(DtpErrorCode::AgreementExpired)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DagStatus {
    Accepted,
    Pending(Vec<String>),
    RejectedCycle(DtpErrorCode),
}

/// DAG acyclicity & out-of-order dependency resolution evaluator.
#[derive(Default)]
pub struct DagEvaluator {
    accepted: HashSet<String>,
    edges: HashMap<String, Vec<DagEdge>>,
    pending: HashMap<String, Vec<DagEdge>>,
}

impl DagEvaluator {
    pub fn add_fragment(&mut self, fragment_id: &str, deps: Vec<DagEdge>) -> DagStatus {
        if !self.is_acyclic(fragment_id, &deps) {
            return DagStatus::RejectedCycle(DtpErrorCode::DagCycleDetected);
        }

        let unresolved: Vec<String> = deps
            .iter()
            .filter(|e| !self.accepted.contains(&e.target_fragment_id))
            .map(|e| e.target_fragment_id.clone())
            .collect();

        if !unresolved.is_empty() {
            self.pending.insert(fragment_id.to_string(), deps);
            return DagStatus::Pending(unresolved);
        }

        self.accepted.insert(fragment_id.to_string());
        self.edges.insert(fragment_id.to_string(), deps);
        self.resolve_pending_cascade();
        DagStatus::Accepted
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    fn is_acyclic(&self, fragment_id: &str, deps: &[DagEdge]) -> bool {
        for edge in deps {
            if edge.target_fragment_id == fragment_id {
                return false;
            }
            if self.accepted.contains(&edge.target_fragment_id) {
                let mut visited = HashSet::new();
                if self.reaches(&edge.target_fragment_id, fragment_id, &mut visited) {
                    return false;
                }
            }
        }
        true
    }

    fn reaches(&self, current: &str, goal: &str, visited: &mut HashSet<String>) -> bool {
        if current == goal {
            return true;
        }
        if !visited.insert(current.to_string()) {
            return false;
        }
        if let Some(edges) = self.edges.get(current) {
            for edge in edges {
                if self.reaches(&edge.target_fragment_id, goal, visited) {
                    return true;
                }
            }
        }
        false
    }

    fn resolve_pending_cascade(&mut self) {
        loop {
            let ready: Vec<String> = self
                .pending
                .iter()
                .filter(|(_, deps)| {
                    deps.iter()
                        .all(|d| self.accepted.contains(&d.target_fragment_id))
                })
                .map(|(id, _)| id.clone())
                .collect();

            if ready.is_empty() {
                break;
            }
            for id in ready {
                if let Some(deps) = self.pending.remove(&id) {
                    self.accepted.insert(id.clone());
                    self.edges.insert(id, deps);
                }
            }
        }
    }
}

/// Bounded exponential-backoff retransmission schedule (`OQ-DTP-11`).
pub fn compute_backoff_delay(attempt: u32, base_delay_ms: u64) -> u64 {
    let shift = attempt.min(30);
    base_delay_ms.saturating_mul(1u64 << shift)
}

pub struct RetrySchedule {
    base_delay_ms: u64,
    max_retries: u32,
    attempts: u32,
}

impl RetrySchedule {
    pub fn new(base_delay_ms: u64, max_retries: u32) -> Self {
        Self {
            base_delay_ms,
            max_retries,
            attempts: 0,
        }
    }

    pub fn next_attempt(&mut self) -> Result<u64, DtpErrorCode> {
        if self.attempts >= self.max_retries {
            return Err(DtpErrorCode::RetransmissionTimeout);
        }
        let delay = compute_backoff_delay(self.attempts, self.base_delay_ms);
        self.attempts += 1;
        Ok(delay)
    }
}
