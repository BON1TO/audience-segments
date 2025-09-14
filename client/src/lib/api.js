// client/src/lib/api.js
import axios from "axios";

const BASE = typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : "";

const api = axios.create({
  baseURL: BASE,            // e.g. http://localhost:4000
  withCredentials: false,    //false since i dont use cookies
  headers: { "Content-Type": "application/json" },
});

// helper that normalizes backend responses into { items, total, page, limit }
function normalizeListResponse(resp, defaultPage = 1, defaultLimit = 50) {
  const data = resp?.data ?? resp;
  // data might be: { items: [...] } || { users: [...] } || { segments: [...] } || [...] || { total, users }
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
// NOTE: adjust endpoint to match your backend - see comment below
export const createSegment = async (segmentData) => {
  // If your backend expects POST /api/segments/new change the path to '/api/segments/new'
  // Most REST conventions use POST /api/segments to create a new segment.
  const resp = await api.post("/api/segments", segmentData);
  return resp.data;
};


export default api;
