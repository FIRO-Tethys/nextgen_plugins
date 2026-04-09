// FlowpathsPmtilesMap.jsx
import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

const STYLE_URL =
  "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json";

const SOURCE_ID = "hydrofabric-pmtiles";
const BASE_LAYER_ID = "hydrofabric-base";
const HIGHLIGHT_LAYER_ID = "hydrofabric-highlight";
const HIGHLIGHT_OUTLINE_LAYER_ID = "hydrofabric-highlight-outline";

let protocolRegistered = false;

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

/**
 * Fallback source-layer names.
 * If your MCP tool can return `highlight.source_layer`,
 * that is better than relying on this local lookup.
 */
const SOURCE_LAYER_BY_KEY = {
  flowpaths: "conus_flowpaths",
  divides: "divides",
  gage: "conus_gauges",
  hydrolocations: "hydrolocations",
};

function removeLayerIfExists(map, layerId) {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
}

function removeSourceIfExists(map, sourceId) {
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function extendBounds(bounds, geometry) {
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      bounds.extend([coords[0], coords[1]]);
      return;
    }
    for (const child of coords) {
      visit(child);
    }
  };
  visit(geometry?.coordinates);
}

function getLayerConfig({ layerKey, sourceLayer, idProperty, value, colors }) {
  const filter = ["==", ["to-string", ["get", idProperty]], String(value)];

  if (layerKey === "flowpaths") {
    return {
      sourceLayer,
      baseLayers: [
        {
          id: BASE_LAYER_ID,
          type: "line",
          paint: {
            "line-color": colors.defaultLineColor,
            "line-width": 1.25,
            "line-opacity": 0.45,
          },
        },
      ],
      highlightLayers: [
        {
          id: HIGHLIGHT_LAYER_ID,
          type: "line",
          filter,
          paint: {
            "line-color": colors.highlightLineColor,
            "line-width": 4,
            "line-opacity": 1,
          },
        },
      ],
    };
  }

  if (layerKey === "divides") {
    return {
      sourceLayer,
      baseLayers: [
        {
          id: BASE_LAYER_ID,
          type: "fill",
          paint: {
            "fill-color": colors.defaultFillColor,
            "fill-opacity": 0.12,
          },
        },
      ],
      highlightLayers: [
        {
          id: HIGHLIGHT_LAYER_ID,
          type: "fill",
          filter,
          paint: {
            "fill-color": colors.highlightFillColor,
            "fill-opacity": 0.3,
          },
        },
        {
          id: HIGHLIGHT_OUTLINE_LAYER_ID,
          type: "line",
          filter,
          paint: {
            "line-color": colors.highlightOutlineColor,
            "line-width": 2.5,
            "line-opacity": 1,
          },
        },
      ],
    };
  }

  if (layerKey === "gage" || layerKey === "hydrolocations") {
    return {
      sourceLayer,
      baseLayers: [
        {
          id: BASE_LAYER_ID,
          type: "circle",
          paint: {
            "circle-radius": 4,
            "circle-color": colors.defaultCircleColor,
            "circle-stroke-color": colors.defaultCircleStrokeColor,
            "circle-stroke-width": 1,
            "circle-opacity": 0.8,
          },
        },
      ],
      highlightLayers: [
        {
          id: HIGHLIGHT_LAYER_ID,
          type: "circle",
          filter,
          paint: {
            "circle-radius": 7,
            "circle-color": colors.highlightCircleColor,
            "circle-stroke-color": colors.highlightCircleStrokeColor,
            "circle-stroke-width": 2,
            "circle-opacity": 1,
          },
        },
      ],
    };
  }

  return null;
}

function addConfiguredLayers(map, { sourceLayer, baseLayers, highlightLayers }) {
  for (const layer of baseLayers) {
    if (!map.getLayer(layer.id)) {
      map.addLayer({
        id: layer.id,
        type: layer.type,
        source: SOURCE_ID,
        "source-layer": sourceLayer,
        paint: layer.paint,
      });
    }
  }

  for (const layer of highlightLayers) {
    if (!map.getLayer(layer.id)) {
      map.addLayer({
        id: layer.id,
        type: layer.type,
        source: SOURCE_ID,
        "source-layer": sourceLayer,
        filter: layer.filter,
        paint: layer.paint,
      });
    } else {
      map.setFilter(layer.id, layer.filter);
    }
  }
}

export default function FlowpathsPmtilesMap({
  mapConfig = null,
  styleUrl = STYLE_URL,
  defaultLineColor = "#38bdf8",
  highlightLineColor = "#ffb703",
  defaultFillColor = "#60a5fa",
  highlightFillColor = "#fbbf24",
  highlightOutlineColor = "#f59e0b",
  defaultCircleColor = "#38bdf8",
  defaultCircleStrokeColor = "#0f172a",
  highlightCircleColor = "#fbbf24",
  highlightCircleStrokeColor = "#ffffff",
  height = "500px",
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  const colors = useMemo(
    () => ({
      defaultLineColor,
      highlightLineColor,
      defaultFillColor,
      highlightFillColor,
      highlightOutlineColor,
      defaultCircleColor,
      defaultCircleStrokeColor,
      highlightCircleColor,
      highlightCircleStrokeColor,
    }),
    [
      defaultLineColor,
      highlightLineColor,
      defaultFillColor,
      highlightFillColor,
      highlightOutlineColor,
      defaultCircleColor,
      defaultCircleStrokeColor,
      highlightCircleColor,
      highlightCircleStrokeColor,
    ]
  );

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

    map.on("mousemove", HIGHLIGHT_LAYER_ID, (e) => {
      map.getCanvas().style.cursor = "pointer";

      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties ?? {};
      const entries = Object.entries(props)
        .slice(0, 8)
        .map(
          ([k, v]) =>
            `<div style="font-size:12px;line-height:1.35;"><strong>${k}</strong>: ${String(v)}</div>`
        )
        .join("");

      popupRef.current.setLngLat(e.lngLat).setHTML(entries).addTo(map);
    });

    map.on("mouseleave", HIGHLIGHT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    });

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapConfig?.highlight) return;

    const highlight = mapConfig.highlight;
    const camera = mapConfig.camera ?? {};
    const layerKey = String(highlight.layer_key ?? "").trim().toLowerCase();
    const pmtilesUrl = highlight.pmtiles_url;
    const idProperty = highlight.id_property;
    const value = highlight.value;
    const sourceLayer =
      highlight.source_layer || SOURCE_LAYER_BY_KEY[layerKey];

    if (!pmtilesUrl || !layerKey || !idProperty || value == null || !sourceLayer) {
      console.warn("Incomplete hydrofabric mapConfig.highlight:", highlight);
      return;
    }

    const layerConfig = getLayerConfig({
      layerKey,
      sourceLayer,
      idProperty,
      value,
      colors,
    });

    if (!layerConfig) {
      console.warn(`Unsupported hydrofabric layer_key: ${layerKey}`);
      return;
    }

    let cancelled = false;

    const clearExisting = () => {
      removeLayerIfExists(map, HIGHLIGHT_OUTLINE_LAYER_ID);
      removeLayerIfExists(map, HIGHLIGHT_LAYER_ID);
      removeLayerIfExists(map, BASE_LAYER_ID);
      removeSourceIfExists(map, SOURCE_ID);
    };

    const focusFeature = (attempt = 0) => {
      if (cancelled) return;
      if (!map.getLayer(HIGHLIGHT_LAYER_ID)) {
        retryTimeoutRef.current = setTimeout(() => focusFeature(attempt + 1), 250);
        return;
      }

      if (Array.isArray(camera.center) && camera.center.length === 2 && attempt === 0) {
        map.easeTo({
          center: camera.center,
          zoom: camera.zoom ?? 10,
          duration: 700,
          essential: true,
        });
      }

      requestAnimationFrame(() => {
        if (cancelled) return;

        const canvas = map.getCanvas();
        const rendered = map.queryRenderedFeatures(
          [
            [0, 0],
            [canvas.width, canvas.height],
          ],
          { layers: [HIGHLIGHT_LAYER_ID] }
        );

        const matched = rendered.filter(
          (feature) =>
            String(feature?.properties?.[idProperty] ?? "") === String(value)
        );

        if (!matched.length) {
          if (attempt < 20) {
            retryTimeoutRef.current = setTimeout(() => focusFeature(attempt + 1), 250);
          }
          return;
        }

        const bounds = new maplibregl.LngLatBounds();
        for (const feature of matched) {
          if (feature?.geometry) {
            extendBounds(bounds, feature.geometry);
          }
        }

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: camera.padding ?? 40,
            maxZoom: camera.maxZoom ?? 13,
            duration: 800,
          });
          return;
        }

        if (Array.isArray(camera.center) && camera.center.length === 2) {
          map.easeTo({
            center: camera.center,
            zoom: camera.zoom ?? 10,
            duration: 700,
            essential: true,
          });
        }
      });
    };

    const applyMapConfig = () => {
      clearExisting();

      map.addSource(SOURCE_ID, {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
      });

      addConfiguredLayers(map, layerConfig);
      focusFeature();
    };

    if (map.isStyleLoaded()) {
      applyMapConfig();
    } else {
      map.once("load", applyMapConfig);
    }

    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [mapConfig, colors]);

  return <div ref={mapContainerRef} style={{ width: "100%", height }} />;
}
