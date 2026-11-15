//! RFC 8785 JSON Canonicalization Scheme (JCS) serializer for DTP 1.0 headers (`OQ-DTP-7`).
//!
//! Recursively sorts object keys by UTF-16 code unit order (RFC 8785 §3.2.3) and
//! emits compact UTF-8 JSON without extraneous whitespace.

use serde_json::Value;

pub fn canonicalize_json_value(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).expect("primitive JSON serialization is infallible")
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonicalize_json_value).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|(ka, _), (kb, _)| {
                let ua: Vec<u16> = ka.encode_utf16().collect();
                let ub: Vec<u16> = kb.encode_utf16().collect();
                ua.cmp(&ub)
            });
            let parts: Vec<String> = entries
                .into_iter()
                .map(|(k, v)| {
                    let key_json =
                        serde_json::to_string(k).expect("string key serialization is infallible");
                    format!("{}:{}", key_json, canonicalize_json_value(v))
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_nested_keys_per_rfc8785() {
        let input = json!({
            "sequenceNumber": 1,
            "protocolVersion": { "minor": 0, "major": 1 },
            "agreementId": null,
            "dagDependencies": [{ "targetFragmentId": "f1", "relationType": "derived_from" }]
        });
        let out = canonicalize_json_value(&input);
        assert_eq!(
            out,
            r#"{"agreementId":null,"dagDependencies":[{"relationType":"derived_from","targetFragmentId":"f1"}],"protocolVersion":{"major":1,"minor":0},"sequenceNumber":1}"#
        );
    }
}
