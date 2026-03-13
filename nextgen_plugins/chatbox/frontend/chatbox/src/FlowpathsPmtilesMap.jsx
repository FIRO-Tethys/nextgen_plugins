// FlowpathsPmtilesMap.jsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

const PMTILES_URL =
  "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/kepler/flowpaths.pmtiles";
const STYLE_URL =
  "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json";

const SOURCE_ID = "flowpaths-pmtiles";
const SOURCE_LAYER = "conus_flowpaths"; // assumed source-layer name
const ID_FIELD = "id";

let protocolRegistered = false;

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function normalizeFlowpathId(featureId) {
  if (featureId == null) return null;
  const raw = String(featureId).trim();
  if (!raw) return null;
  return /^wb-/i.test(raw) ? `wb-${raw.replace(/^wb-/i, "")}` : `wb-${raw}`;
}

export default function FlowpathsPmtilesMap({
  featureId = null,
  highlightColor = "#ffb703",
  defaultColor = "#38bdf8",
  styleUrl = STYLE_URL,
  pmtilesUrl = PMTILES_URL,
  sourceLayer = SOURCE_LAYER,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    ensurePmtilesProtocol();

    if (mapRef.current || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [-98.5, 39.5],
      zoom: 4,
    });

    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
    });

    map.on("load", () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${pmtilesUrl}`,
        });
      }

      if (!map.getLayer("flowpaths-base")) {
        map.addLayer({
          id: "flowpaths-base",
          type: "line",
          source: SOURCE_ID,
          "source-layer": sourceLayer,
          paint: {
            "line-color": defaultColor,
            "line-width": 1.25,
            "line-opacity": 0.5,
          },
        });
      }

      if (!map.getLayer("flowpaths-highlight")) {
        map.addLayer({
          id: "flowpaths-highlight",
          type: "line",
          source: SOURCE_ID,
          "source-layer": sourceLayer,
          filter: ["==", ["get", ID_FIELD], "__none__"],
          paint: {
            "line-color": highlightColor,
            "line-width": 3.5,
            "line-opacity": 1.0,
          },
        });
      }

      map.on("mousemove", "flowpaths-highlight", (e) => {
        map.getCanvas().style.cursor = "pointer";

        const feature = e.features?.[0];
        if (!feature) return;

        const idValue = feature.properties?.[ID_FIELD] ?? "";
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font-size:12px;">id: ${idValue}</div>`)
          .addTo(map);
      });

      map.on("mouseleave", "flowpaths-highlight", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [defaultColor, highlightColor, pmtilesUrl, sourceLayer, styleUrl]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;

  const normalizedId = normalizeFlowpathId(featureId);
  let cancelled = false;
  let timeoutId = null;

  const extendBounds = (bounds, geometry) => {
    const visit = (coords) => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        bounds.extend([coords[0], coords[1]]);
        return;
      }
      for (const c of coords) visit(c);
    };
    visit(geometry?.coordinates);
  };

  const tryFocus = (attempt = 0) => {
    if (cancelled || !normalizedId) return;
    if (!map.getLayer("flowpaths-highlight")) {
      timeoutId = setTimeout(() => tryFocus(attempt + 1), 250);
      return;
    }

    const filter = ["==", ["get", ID_FIELD], normalizedId];
    map.setFilter("flowpaths-highlight", filter);

    requestAnimationFrame(() => {
      const canvas = map.getCanvas();
      const features = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]],
        { layers: ["flowpaths-highlight"] }
      );

      console.log("highlight rendered features:", features.length, "attempt:", attempt);

      if (!features.length) {
        if (attempt < 20) {
          timeoutId = setTimeout(() => tryFocus(attempt + 1), 250);
        }
        return;
      }

      const bounds = new maplibregl.LngLatBounds();
      for (const feature of features) {
        if (feature?.geometry) {
          extendBounds(bounds, feature.geometry);
        }
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 40,
          duration: 800,
          maxZoom: 13,
        });
      }
    });
  };

  if (map.isStyleLoaded()) {
    tryFocus();
  } else {
    map.once("load", () => tryFocus());
  }

  return () => {
    cancelled = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
}, [featureId]);

  return <div ref={mapContainerRef} style={{ width: "100%", height: "500px" }} />;
}