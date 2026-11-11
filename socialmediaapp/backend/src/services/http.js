import axios from 'axios';

/**
 * Shared HTTP client for all outbound calls to platform APIs.
 *
 * The key reason this exists: a bare axios call has NO timeout, so if an
 * outbound request to a platform (e.g. graph.facebook.com) stalls — common on
 * corporate networks with SSL inspection / egress filtering — the request
 * hangs forever and the user sees a blank, never-closing OAuth popup. With a
 * timeout the call fails fast with a clear error that we log.
 *
 * Timeout is configurable via HTTP_TIMEOUT_MS (default 15000).
 */
const timeout = Number(process.env.HTTP_TIMEOUT_MS) || 15000;

export const http = axios.create({ timeout });
