import { describe, it, expect } from "vitest";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { caIssuerUrl, trustedIssuer } from "../../scripts/chain-repair";

/**
 * Repairing a certificate chain a server did not serve completely.
 *
 * Mississippi's Department of Information Technology Services runs every
 * `*.ms.gov` host and every one of them presents the leaf alone, omitting the
 * GlobalSign intermediate that signed it. Browsers follow the leaf's Authority
 * Information Access pointer to fetch the missing certificate; Node's `fetch`
 * refuses, so the whole state — Revenue, the Legislature, all of it — was
 * unreachable from this pipeline, and Mississippi's rate steps down by statute
 * every January.
 *
 * The network half runs on a schedule, never here. What is tested here is the
 * part that must not be wrong: which certificate the pipeline agrees to trust.
 */
describe("finding the certificate the server left out", () => {
  it("takes the CA Issuers pointer and not the OCSP responder beside it", () => {
    const infoAccess =
      "CA Issuers - URI:http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt\n" +
      "OCSP - URI:http://ocsp.globalsign.com/gsrsaovsslca2018\n";
    expect(caIssuerUrl(infoAccess)).toBe(
      "http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt",
    );
  });

  it("finds the pointer wherever in the extension it sits", () => {
    expect(caIssuerUrl("OCSP - URI:http://o.example/x\nCA Issuers - URI:http://c.example/y")).toBe(
      "http://c.example/y",
    );
  });

  it("has no answer when the extension is absent or names no issuer", () => {
    expect(caIssuerUrl(undefined)).toBeUndefined();
    expect(caIssuerUrl("")).toBeUndefined();
    expect(caIssuerUrl("OCSP - URI:http://ocsp.example/only")).toBeUndefined();
    // A substring of a longer line is not the field.
    expect(caIssuerUrl("Other CA Issuers - URI:http://c.example/y")).toBeUndefined();
  });
});

describe("deciding whether to trust the certificate that comes back", () => {
  const roots = tls.rootCertificates.map((pem) => new X509Certificate(pem));

  it("accepts one a certificate already in the root store signed", () => {
    // A root is self-signed, so it is its own issuer and passes both halves —
    // which is exactly the condition an intermediate has to meet.
    const root = roots[0]!;
    expect(trustedIssuer(root, roots)?.subject).toBe(root.subject);
  });

  it("refuses one nothing in the root store signed", () => {
    // This is the whole vulnerability if it is skipped: everything in the
    // bundle is a trust anchor, so accepting whatever the leaf's AIA pointed at
    // would let anyone who can answer that connection mint a certificate this
    // pipeline believes.
    expect(trustedIssuer(roots[0]!, [])).toBeUndefined();
  });

  it("refuses one whose issuer name matches a root that did not sign it", () => {
    // A subject line is a claim, not a signature. Give a real root a stand-in
    // whose issuer name matches but whose key does not, and it must not pass.
    const a = roots[0]!;
    const impostor = roots.find((r) => r.subject !== a.subject)!;
    const claimed = {
      issuer: a.subject,
      verify: (key: Parameters<X509Certificate["verify"]>[0]) => impostor.verify(key),
    } as unknown as X509Certificate;
    expect(trustedIssuer(claimed, [a])).toBeUndefined();
  });

  it("treats a certificate that throws on verification as untrusted", () => {
    const throws = {
      issuer: roots[0]!.subject,
      verify: () => {
        throw new Error("unsupported key");
      },
    } as unknown as X509Certificate;
    expect(trustedIssuer(throws, [roots[0]!])).toBeUndefined();
  });
});
