// Browser build only: a throwaway signing certificate made with WebCrypto when first
// asked for, so the certificate-signing UI can run in e2e tests. Never stored.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { CertInfo } from "./types";

let made: Promise<{ info: CertInfo; sign(data: Uint8Array): Promise<Uint8Array> }> | null = null;

export function browserTestCert() {
  made ??= (async () => {
    const alg = {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    };
    const keys = await crypto.subtle.generateKey(alg, false, ["sign", "verify"]);
    const cert = new pkijs.Certificate();
    cert.version = 2;
    cert.serialNumber = new asn1js.Integer({ value: 8 });
    const name = () => [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: "Browser Test Signer" }),
      }),
    ];
    cert.issuer.typesAndValues = name();
    cert.subject.typesAndValues = name();
    cert.notBefore.value = new Date(Date.now() - 86400000);
    cert.notAfter.value = new Date(Date.now() + 365 * 86400000);
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
    await cert.sign(keys.privateKey, "SHA-256");
    const der = new Uint8Array(cert.toSchema(true).toBER());
    return {
      info: {
        thumbprint: "00".repeat(20),
        name: "Browser Test Signer",
        issuer: "Browser Test Signer",
        expires: cert.notAfter.value.toISOString().slice(0, 10),
        chain: [der],
      },
      sign: async (data: Uint8Array) =>
        new Uint8Array(
          await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, data.slice()),
        ),
    };
  })();
  return made;
}
