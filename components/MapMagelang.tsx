"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  union,
  featureCollection,
  buffer,
  difference,
  intersect,
} from "@turf/turf";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const FILE = "/data/kelurahan-magelang.geojson";
const PROP_NAMA = "NAME_4"; // nama kelurahan
const PROP_KEC = "NAME_3"; // nama kecamatan

// Logo header (file ada di folder public)
const LOGO_SRC = "/kota-magelang.png";

// Atur jarak logo. PNG-nya punya ruang kosong di kiri/kanan lambang,
// jadi kita tarik pakai margin negatif. Makin besar angkanya, makin dekat.
const LOGO_TARIK_KIRI = 16; // tarik ke kiri (dekat pinggir kotak)
const LOGO_TARIK_KANAN = 22; // tarik teks mendekat ke logo

// Lebar celah yang ditambal (meter).
// Naikkan kalau masih ada celah, turunkan kalau bentuk berubah.
const LEBAR_CELAH = 60;

// Garis pinggir kota: hitam, agak tipis
const BATAS_WARNA = "#000000";
const BATAS_OPACITY = 0.85;
const BATAS_LEBAR = 2.5;

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

// Hanya ambil cincin luar (buang semua lubang di tengah)
function tanpaLubang(fitur: any): any {
  const g = fitur.geometry;
  return {
    type: "Feature",
    properties: {},
    geometry:
      g.type === "Polygon"
        ? { type: "Polygon", coordinates: [g.coordinates[0]] }
        : {
            type: "MultiPolygon",
            coordinates: g.coordinates.map((p: any) => [p[0]]),
          },
  };
}

// Menambal celah antar kelurahan dan membuat batas luar tanpa lubang
function tambalCelah(kel: any) {
  const opsi: any = { units: "meters" };
  const fc = (a: any[]): any => featureCollection(a as any) as any;

  const semua: any = (union as any)(fc(kel.features));

  // Tutup semua celah, lalu ambil tepi luar saja
  const besar: any = (buffer as any)(semua, LEBAR_CELAH, opsi);
  const tutup: any = (buffer as any)(besar, -LEBAR_CELAH, opsi);
  const luar: any = tanpaLubang(tutup);

  // Tiap kelurahan melebar hanya ke area kosong di dekatnya
  let diklaim: any = null;
  const hasilFitur: any[] = [];

  kel.features.forEach((f: any) => {
    const lebar: any = (buffer as any)(f, LEBAR_CELAH, opsi);
    let isi: any = (difference as any)(fc([lebar, semua]));
    if (isi && diklaim) isi = (difference as any)(fc([isi, diklaim]));
    if (isi)
      diklaim = diklaim ? (union as any)(fc([diklaim, isi])) : isi;

    let hasil: any = isi ? (union as any)(fc([f, isi])) : f;
    hasil = (intersect as any)(fc([hasil, luar]));
    if (!hasil) return;

    hasil.id = f.id;
    hasil.properties = f.properties;
    hasilFitur.push(hasil);
  });

  return {
    kel: { type: "FeatureCollection", features: hasilFitur },
    luar,
  };
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

        // Tambal celah + batas luar tanpa lubang
        let kelRapat: any = kel;
        let batas: any;
        try {
          const hasil = tambalCelah(kel);
          kelRapat = hasil.kel;
          batas = hasil.luar;
        } catch (e) {
          // Kalau penambalan gagal, tetap tampil dengan data asli
          console.warn("Penambalan celah gagal, memakai data asli:", e);
          batas = tanpaLubang(
            (union as any)(
              (featureCollection as any)(kel.features)
            )
          );
        }

        map.addSource("kelurahan", { type: "geojson", data: kelRapat });
        map.addSource("batas", { type: "geojson", data: batas });

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

        // Garis pinggir kota (hitam, agak tipis)
        map.addLayer({
          id: "batas-line",
          type: "line",
          source: "batas",
          paint: {
            "line-color": BATAS_WARNA,
            "line-width": BATAS_LEBAR,
            "line-opacity": BATAS_OPACITY,
          },
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

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100vh" }} />

      {/* Header: logo + judul */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: LOGO_SRC ? "8px 16px 8px 10px" : "8px 16px 8px 14px",
          maxWidth: "calc(100% - 80px)",
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(6px)",
          borderRadius: 12,
          borderLeft: "4px solid #dc2626",
          boxShadow: "0 4px 14px rgba(0, 0, 0, 0.18)",
          pointerEvents: "none",
        }}
      >
        {LOGO_SRC && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={LOGO_SRC}
            alt="Logo Kota Magelang"
            style={{
              height: 46,
              width: "auto",
              objectFit: "contain",
              marginLeft: -LOGO_TARIK_KIRI,
              marginRight: -LOGO_TARIK_KANAN,
            }}
          />
        )}
        <div style={{ lineHeight: 1.15 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.12em",
              color: "#6b7280",
            }}
          >
            PETA KEWASPADAAN DAERAH
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "0.04em",
              color: "#111827",
            }}
          >
            KOTA MAGELANG
          </div>
        </div>
      </div>
    </div>
  );
}