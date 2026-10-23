import type { BlobTransport, RemoteClient } from "@atomic/core";

/**
 * `blob-transport.ts` for `expo start --web`: the browser's `fetch` handles
 * binary bodies, so the client's own photo transport is used as is. Only
 * the QA export with in-memory photos ever gets here. Owner: T5.
 */
export function nativeBlobTransport(client: RemoteClient, token: string): BlobTransport {
	return client.blobTransport(token);
}
