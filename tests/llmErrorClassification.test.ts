import { describe, expect, it } from 'vitest';
import {
  isAvailabilityError,
  isModelUnavailableError,
  isQuotaError,
} from '../functions/src/llm/errorClassification';

// Error shapes below are live-captured from real provider responses
// (2026-07-12 audit against the production Gemini key) — not invented.

const retiredModel404 = {
  status: 404,
  message:
    '{"error":{"code":404,"message":"This model models/gemini-2.0-flash is no longer available. Please update your code to use a newer model for the latest features","status":"NOT_FOUND"}}',
};

const badKey400 = {
  status: 400,
  message:
    '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
};

const quota429 = {
  status: 429,
  message:
    '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}',
};

describe('llm error classification', () => {
  it('classifies a retired Gemini model 404 as unavailable AND availability-class', () => {
    // Regression: this exact error previously matched NEITHER classifier, so a
    // retired primary model hard-failed every request — no internal Gemini
    // fallback, no fallback chain, no routing-pool rotation.
    expect(isModelUnavailableError(retiredModel404)).toBe(true);
    expect(isAvailabilityError(retiredModel404)).toBe(true);
    expect(isQuotaError(retiredModel404)).toBe(false);
  });

  it('classifies unknown-model messages from Gemini and OpenAI-compatible gateways', () => {
    expect(
      isModelUnavailableError({
        message: 'models/gemini-9.9-nope is not found for API version v1beta, or is not supported for generateContent',
      }),
    ).toBe(true);
    expect(isModelUnavailableError({ message: 'LLM provider error 404: The model `foo` does not exist' })).toBe(true);
    expect(isModelUnavailableError({ message: 'model not found' })).toBe(true);
  });

  it('classifies quota exhaustion as quota AND availability-class, not model-unavailable', () => {
    expect(isQuotaError(quota429)).toBe(true);
    expect(isAvailabilityError(quota429)).toBe(true);
    expect(isModelUnavailableError(quota429)).toBe(false);
    expect(isQuotaError({ code: 'resource-exhausted' })).toBe(true);
  });

  it('classifies a bad API key (Gemini reports 400, not 401) as availability-class', () => {
    expect(isAvailabilityError(badKey400)).toBe(true);
    expect(isQuotaError(badKey400)).toBe(false);
  });

  it('does NOT classify quality errors as availability-class', () => {
    expect(isAvailabilityError({ status: 400, message: 'Invalid JSON payload received.' })).toBe(false);
    expect(isAvailabilityError(new Error('The AI returned a response that could not be parsed as JSON.'))).toBe(false);
    expect(isModelUnavailableError({ status: 400, message: 'Invalid JSON payload received.' })).toBe(false);
  });

  it('keeps the existing availability triggers', () => {
    expect(isAvailabilityError({ status: 402, message: 'free trial quota exhausted' })).toBe(true);
    expect(isAvailabilityError({ status: 503, message: 'service unavailable' })).toBe(true);
    expect(isAvailabilityError({ code: 504 })).toBe(true);
    expect(isAvailabilityError({ status: 429 })).toBe(true);
    expect(isAvailabilityError({ message: 'LLM provider error 403: forbidden' })).toBe(true);
    expect(isAvailabilityError({ message: 'No endpoints found that support image input' })).toBe(true);
    expect(isAvailabilityError({ message: 'request timed out' })).toBe(true);
    expect(isAvailabilityError({ message: 'Gemini returned an empty response.' })).toBe(true);
    expect(isAvailabilityError({ message: 'All API keys for model "kairllm" are unavailable.' })).toBe(true);
    expect(isAvailabilityError({ message: 'fetch failed' })).toBe(true);
  });
});
