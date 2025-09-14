// client/src/lib/api.js
import axios from "axios";

// ✅ Hardcode backend URL for production, fallback to localhost for dev
const BASE =
  import.meta.env?.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname.includes("onrender.com")
    ? "https://audience-segments.onrender.com"
    : "http://localhost:4000");

console.log("API Base URL:", BASE); // Debug log, remove later if you want

const api = axios.create({
  baseURL: BASE,
  withCredentials: false, // false since you don’t use cookies
  headers: { "Content-Type": "application/json" },
});

// helper that normalizes backend responses into { items, total, page, limit }
function normalizeListResponse(resp, defaultPage = 1, defaultLimit = 50) {
  const data = resp?.data ?? resp;
  let items = [];
  if (Array.isArray(data)) items = data;
  else items = data.items ?? data.users ?? data.segments ?? [];

  const total = data.total ?? (Array.isArray(data) ? items.length : items.length);
  const page = data.page ?? defaultPage;
  const limit = data.limit ?? defaultLimit;

  return { items, total, page, limit, raw: data };
}

export const getSegments = async (params) => {
  const resp = await api.get("/api/segments", { params });
  return normalizeListResponse(resp);
};

export const getSegment = async (id) => {
  const resp = await api.get(`/api/segments/${id}`);
  return resp.data;
};

export const getSegmentUsers = async (id, { limit = 50, page = 1 } = {}) => {
  const resp = await api.get(`/api/segments/${id}/users`, { params: { limit, page } });
  return normalizeListResponse(resp, page, limit);
};

export const getUsers = async (params) => {
  const resp = await api.get("/api/users", { params });
  return normalizeListResponse(resp);
};

export const getCampaigns = async (params) => {
  const resp = await api.get("/api/campaigns", { params });
  return normalizeListResponse(resp);
};

// create a new segment
export const createSegment = async (segmentData) => {
  const resp = await api.post("/api/segments", segmentData);
  return resp.data;
};

export default api;
