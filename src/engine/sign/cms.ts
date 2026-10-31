// The CMS SignedData inside a PAdES signature (ETSI EN 319 142-1 baseline B-B):
// detached, SHA-256, signed attributes contentType, messageDigest and
// signing-certificate-v2. No signing-time attribute: PAdES puts the time in /M.
//
// The private key never reaches this code: a `CertSigner` signs the DER signed
// attributes (the app's signer is Windows CNG in Rust; tests use WebCrypto).

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsa: "1.2.840.113549.1.1.1",
  ecPublicKey: "1.2.840.10045.2.1",
  ecdsaSha256: "1.2.840.10045.4.3.2",
};

export interface CertSigner {
  /** DER certificates: the signer's first, then whatever of its chain is known. */
  certificates: Uint8Array[];
  /**
   * Signs `data` with SHA-256: RSA PKCS#1 v1.5, or ECDSA returning r || s (as
   * WebCrypto and CNG do).
   */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

const buf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(data)));
}

export function parseCertificate(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(buf(der));
}

/** The certificate's subject common name (or the whole subject when it has none). */
export function certName(cert: pkijs.Certificate): string {
  const rdn = cert.subject.typesAndValues;
  const cn = rdn.find((t) => t.type === "2.5.4.3");
  const text = (t: pkijs.AttributeTypeAndValue) => String(t.value.valueBlock.value ?? "");
  return cn ? text(cn) : rdn.map(text).join(", ");
}

/** DER SEQUENCE { r, s } from ECDSA's raw r || s. */
export function ecdsaDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    const padded = (v[0] ?? 0) & 0x80 ? Uint8Array.of(0, ...v) : v;
    return new asn1js.Integer({ valueHex: buf(padded) });
  };
  const seq = new asn1js.Sequence({ value: [int(raw.subarray(0, half)), int(raw.subarray(half))] });
  return new Uint8Array(seq.toBER());
}

/** The DER CMS ContentInfo for a detached signature over content with `digest`. */
export async function buildCms(signer: CertSigner, digest: Uint8Array): Promise<Uint8Array> {
  const [first] = signer.certificates;
  if (!first) throw new Error("the certificate is missing");
  const cert = parseCertificate(first);
  const isEc = cert.subjectPublicKeyInfo.algorithm.algorithmId === OID.ecPublicKey;

  const essCertIdV2 = new asn1js.Sequence({
    value: [
      new asn1js.OctetString({ valueHex: buf(await sha256(first)) }),
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.Constructed({
                idBlock: { tagClass: 3, tagNumber: 4 },
                value: [cert.issuer.toSchema()],
              }),
            ],
          }),
          cert.serialNumber,
        ],
      }),
    ],
  });
  const attrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: OID.contentType,
        values: [new asn1js.ObjectIdentifier({ value: OID.data })],
      }),
      new pkijs.Attribute({
        type: OID.messageDigest,
        values: [new asn1js.OctetString({ valueHex: buf(digest) })],
      }),
      new pkijs.Attribute({
        type: OID.signingCertificateV2,
        values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] })],
      }),
    ],
  });
  // What is signed is the attributes as a DER SET (tag 0x31), not the [0] IMPLICIT form.
  const tbs = new Uint8Array(attrs.toSchema().toBER());
  tbs[0] = 0x31;
  const raw = await signer.sign(tbs);
  const signature = isEc ? ecdsaDer(raw) : raw;

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs: attrs,
    signatureAlgorithm: isEc
      ? new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaSha256 })
      : new pkijs.AlgorithmIdentifier({ algorithmId: OID.rsa, algorithmParams: new asn1js.Null() }),
    signature: new asn1js.OctetString({ valueHex: buf(signature) }),
  });
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    certificates: signer.certificates.map(parseCertificate),
    signerInfos: [signerInfo],
  });
  const info = new pkijs.ContentInfo({
    contentType: OID.signedData,
    content: signed.toSchema(true),
  });
  return new Uint8Array(info.toSchema().toBER());
}
