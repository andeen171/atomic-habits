import {
	type AttachmentMime,
	type BlobTransport,
	type RemoteClient,
	RemoteError,
	SHA256_RE,
	remoteErrorFrom,
} from "@atomic/core";
import { File, Paths, UploadType } from "expo-file-system";
import { clientHeaders } from "./client-info";

/**
 * Photo backup over the device's file system (spec §2.4.5, D23; Annex C
 * §1.9, §5). React Native's `fetch` can't be trusted with binary bodies, so:
 * - uploads stream the stored file itself (`File.upload`, `PUT /blobs/<sha>`
 *   with the bearer token and the image type);
 * - downloads land in the cache, and their bytes are handed back so blob
 *   sync checks them against their hash before the photo store keeps them;
 *   the cache file is removed right away;
 * - the small JSON call (`blobs.missing`) goes through the regular client.
 * Refusals keep the server's codes (`QUOTA_EXCEEDED`, `TOO_LARGE`,
 * `UNSUPPORTED_TYPE`), so a full storage stops uploads as everywhere else.
 * Nothing but a SHA-256 hash ever goes into a URL that carries the token.
 *
 * `blob-transport.web.ts` is the `expo start --web` stand-in. Owner: T5.
 */
export function nativeBlobTransport(client: RemoteClient, token: string): BlobTransport {
	const remote = client.blobTransport(token);
	const urlOf = (sha: string) => {
		if (!SHA256_RE.test(sha)) throw new RemoteError("Not a SHA-256 hash", 400, "INVALID_HASH");
		return `${client.baseUrl}/blobs/${sha}`;
	};
	const headers = () => ({ ...clientHeaders(), Authorization: `Bearer ${token}` });

	return {
		missing: (hashes) => remote.missing(hashes),

		async upload(sha, source, mime) {
			// Bytes in memory (never from the photo store here): the client's own upload.
			if (!("uri" in source)) return remote.upload(sha, source, mime);
			const url = urlOf(sha);
			const result = await new File(source.uri).upload(url, {
				httpMethod: "PUT",
				uploadType: UploadType.BINARY_CONTENT,
				mimeType: mime,
				headers: { ...headers(), "Content-Type": mime },
			});
			if (result.status >= 200 && result.status < 300) return;
			throw errorOf(result);
		},

		async download(sha) {
			const url = urlOf(sha);
			const target = new File(Paths.cache, `atomic-blob-${sha}.download`);
			try {
				// Rejects on a non-2xx answer; blob sync then shows the placeholder.
				const file = await File.downloadFileAsync(url, target, {
					headers: headers(),
					idempotent: true,
				});
				const bytes = await file.bytes();
				const mime = imageTypeOf(bytes);
				if (!mime) throw new RemoteError("Malformed response", 200);
				return { source: { bytes }, mime };
			} finally {
				try {
					if (target.exists) target.delete();
				} catch {
					// The cache folder is cleaned by the system anyway.
				}
			}
		},
	};
}

/** A `RemoteError` from an upload's answer, read like any other server reply. */
function errorOf(result: {
	status: number;
	headers: Record<string, string>;
	body: string;
}): RemoteError {
	let body: unknown = result.body;
	try {
		body = JSON.parse(result.body);
	} catch {
		// Plain text: kept as the message.
	}
	const lower = new Map(
		Object.entries(result.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
	);
	const response = {
		status: result.status,
		headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
	} as unknown as Response;
	return remoteErrorFrom(response, body);
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
	String.fromCharCode(...bytes.subarray(from, to));

/** JPEG or WebP, by their signatures (the only types the server keeps). */
function imageTypeOf(bytes: Uint8Array): AttachmentMime | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
	return null;
}
