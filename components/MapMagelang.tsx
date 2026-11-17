"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { union, featureCollection } from "@turf/turf";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const FILE = "/data/kelurahan-magelang.geojson"; // satu-satunya file data
const PROP_NAMA = "NAME_4"; // nama kelurahan
const PROP_KEC = "NAME_3"; // nama kecamatan

const PALET = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#84cc16", "#f43f5e",
];

// MagelangUtara -> Magelang Utara
const rapikan = (s: string) =>
  (s ?? "-").replace(/([a-z])([A-Z])/g, "$1 $2");

function getBounds(geojson: any) {
  const bounds = new maplibregl.LngLatBounds();
  const extend = (coords: any) => {
    if (typeof coords[0] === "number") bounds.extend(coords);
    else coords.forEach(extend);
  };
  geojson.features.forEach((f: any) => extend(f.geometry.coordinates));
  return bounds;
}

export default function MapMagelang() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [110.2177, -7.4797],
      zoom: 12,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", async () => {
      try {
        const res = await fetch(FILE);
        if (!res.ok) throw new Error("File tidak ditemukan: " + FILE);
        const kel = await res.json();

        kel.features.forEach((f: any, i: number) => {
          f.id = i;
          f.properties.warna = PALET[i % PALET.length];
          f.properties[PROP_NAMA] = rapikan(f.properties[PROP_NAMA]);
          f.properties[PROP_KEC] = rapikan(f.properties[PROP_KEC]);
        });

        // Batas luar kota = gabungan semua kelurahan
        const batas = union(featureCollection(kel.features));

        map.addSource("kelurahan", { type: "geojson", data: kel });
        map.addSource("batas", { type: "geojson", data: batas as any });

        map.addLayer({
          id: "kel-fill",
          type: "fill",
          source: "kelurahan",
          paint: {
            "fill-color": ["get", "warna"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.75,
              0.45,
            ],
          },
        });

        map.addLayer({
          id: "kel-line",
          type: "line",
          source: "kelurahan",
          paint: { "line-color": "#ffffff", "line-width": 1.5 },
        });

        // Garis biru luar kota
        map.addLayer({
          id: "batas-line",
          type: "line",
          source: "batas",
          paint: { "line-color": "#1d4ed8", "line-width": 4 },
        });

        map.addLayer({
          id: "kel-label",
          type: "symbol",
          source: "kelurahan",
          layout: {
            "text-field": ["get", PROP_NAMA],
            "text-font": ["Open Sans Regular"],
            "text-size": 11,
          },
          paint: {
            "text-color": "#111827",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });

        map.fitBounds(getBounds(kel), { padding: 40 });

        // Hover
        let hoverId: number | null = null;
        map.on("mousemove", "kel-fill", (e) => {
          map.getCanvas().style.cursor = "pointer";
          if (!e.features?.length) return;
          if (hoverId !== null)
            map.setFeatureState({ source: "kelurahan", id: hoverId }, { hover: false });
          hoverId = e.features[0].id as number;
          map.setFeatureState({ source: "kelurahan", id: hoverId }, { hover: true });
        });
        map.on("mouseleave", "kel-fill", () => {
          map.getCanvas().style.cursor = "";
          if (hoverId !== null)
            map.setFeatureState({ source: "kelurahan", id: hoverId }, { hover: false });
          hoverId = null;
        });

        // Popup
        map.on("click", "kel-fill", (e) => {
          const p: any = e.features?.[0]?.properties ?? {};
          new maplibregl.Popup({ offset: 8, closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-judul">Kelurahan ${p[PROP_NAMA] ?? "-"}</div>
               <div class="popup-sub">Kecamatan ${p[PROP_KEC] ?? "-"}</div>`
            )
            .addTo(map);
        });
      } catch (err) {
        console.error("Gagal memuat data:", err);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100vh" }} />;
}