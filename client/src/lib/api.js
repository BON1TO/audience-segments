// client/src/lib/api.js
import axios from "axios";

/**
 * Use Vite env variable VITE_API_URL (set in your Render / Netlify / Vercel env)
 * Example: VITE_API_URL=https://audience-segments.onrender.com/api
 *
 * If VITE_API_URL is not set, we fallback to relative requests (same-origin).
 */
const RAW_BASE = (import.meta?.env?.VITE_API_URL ?? "").trim();
const BASE = RAW_BASE.replace(/\/$/, ""); // remove trailing slash if any

console.log("API Base URL:", BASE || "(relative)");

const api = axios.create({
  baseURL: BASE || "", // if empty -> relative (same origin)
  withCredentials: false, // set true if you use cookie sessions and have CORS credentials enabled
  headers: { "Content-Type": "application/json" },
});

function normalizeListResponse(resp, defaultPage = 1, defaultLimit = 50) {
  const data = resp?.data ?? resp;
  let items = [];
  if (Array.isArray(data)) items = data;
  else items = data.items ?? data.users ?? data.segments ?? [];
  const total = data.total ?? items.length;
  const page = data.page ?? defaultPage;
  const limit = data.limit ?? defaultLimit;
  return { items, total, page, limit, raw: data };
}

export const getSegments = async (params) => {
  const resp = await api.get("/segments", { params });
  return normalizeListResponse(resp);
};

export const getSegment = async (id) => {
  const resp = await api.get(`/segments/${id}`);
  return resp.data;
};

export const getSegmentUsers = async (id, { limit = 50, page = 1 } = {}) => {
  const resp = await api.get(`/segments/${id}/users`, { params: { limit, page } });
  return normalizeListResponse(resp, page, limit);
};

export const getUsers = async (params) => {
  const resp = await api.get("/users", { params });
  return normalizeListResponse(resp);
};

export const getCampaigns = async (params) => {
  const resp = await api.get("/campaigns", { params });
  return normalizeListResponse(resp);
};

export const createSegment = async (segmentData) => {
  const resp = await api.post("/segments", segmentData);
  return resp.data;
};

export default api;
