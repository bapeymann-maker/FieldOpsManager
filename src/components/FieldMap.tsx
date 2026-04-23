'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

type Field = {
  id: string
  name: string
  acres: number | null
  region: string | null
  boundary: object | null
  daysSinceWork?: number
  isInCrop?: boolean
  lastOpType?: string
  cumulativeGDU?: number
  cumulativeRainfall?: number
  gduSinceLastWork?: number
  rainfallSinceLastWork?: number
}

function getWorkHeatColor(days: number | undefined): string {
  if (days === undefined || days === null) return '#1a0000'
  if (days === 0)  return '#0000ff'
  if (days <= 3)   return '#0011ff'
  if (days <= 6)   return '#0033ff'
  if (days <= 9)   return '#0066ff'
  if (days <= 12)  return '#0099ff'
  if (days <= 15)  return '#00ccff'
  if (days <= 18)  return '#00ddcc'
  if (days <= 21)  return '#00bb88'
  if (days <= 24)  return '#22aa44'
  if (days <= 27)  return '#338833'
  if (days <= 30)  return '#446611'
  if (days <= 33)  return '#666600'
  if (days <= 36)  return '#884400'
  if (days <= 39)  return '#aa3300'
  if (days <= 42)  return '#cc2200'
  if (days <= 45)  return '#dd1100'
  if (days <= 48)  return '#ee0800'
  if (days <= 51)  return '#ff0500'
  return '#ff0000'
}

function getDailyActivityColor(days: number | undefined): string {
  if (days === undefined || days === null) return '#2a0000'
  if (days === 0) return '#4B0082'
  if (days === 1) return '#0000ff'
  if (days === 2) return '#008000'
  if (days === 3) return '#ffff00'
  if (days === 4) return '#ffa500'
  if (days === 5) return '#ff6600'
  if (days === 6) return '#ff3300'
  return '#ff0000'
}

function buildPopupHTML(
  name: string,
  acres: number | null,
  daysSinceWork: number,
  lastOpType: string,
  cumulativeGDU: number,
  cumulativeRainfall: number,
  gduSinceLastWork: number,
  rainfallSinceLastWork: number
): string {
  const daysText = daysSinceWork === -1 ? 'Never worked' : `${daysSinceWork} day${daysSinceWork === 1 ? '' : 's'} ago`
  const lastOp = lastOpType ? `<div style="color:#8a9a6a;font-size:12px;margin-top:2px">${lastOpType}</div>` : ''
  const gduTotal = cumulativeGDU > 0 ? `<div style="margin-top:6px;font-size:12px;color:#c8d4a0">GDU since planting: <strong>${cumulativeGDU}</strong></div>` : ''
  const rainTotal = cumulativeRainfall > 0 ? `<div style="font-size:12px;color:#c8d4a0">Rain since planting: <strong>${cumulativeRainfall}"</strong></div>` : ''
  const gduWork = gduSinceLastWork > 0 ? `<div style="font-size:12px;color:#8a9a6a;margin-top:4px">GDU since last worked: <strong style="color:#c8d4a0">${gduSinceLastWork}</strong></div>` : ''
  const rainWork = rainfallSinceLastWork > 0 ? `<div style="font-size:12px;color:#8a9a6a">Rain since last worked: <strong style="color:#c8d4a0">${rainfallSinceLastWork}"</strong></div>` : ''

  return `
    <div style="font-family:Georgia,serif;padding:4px">
      <div style="font-size:14px;font-weight:bold;color:#c8d4a0;margin-bottom:4px">${name}</div>
      <div style="font-size:12px;color:#6b7a5a">${acres ? acres + 'ac · ' : ''}Last worked: ${daysText}</div>
      ${lastOp}${gduTotal}${rainTotal}${gduWork}${rainWork}
    </div>
  `
}

export default function FieldMap({
  fields,
  focusFieldId,
  mode = 'work'
}: {
  fields: Field[]
  focusFieldId?: string | null
  mode?: 'work' | 'daily'
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const mapLoaded = useRef(false)

  const getColor = mode === 'daily' ? getDailyActivityColor : getWorkHeatColor

  function toFeatures(fs: Field[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: fs.filter(f => f.boundary).map(f => ({
        type: 'Feature',
        properties: {
          id: f.id,
          name: f.name,
          acres: f.acres,
          color: getColor(f.daysSinceWork),
          daysSinceWork: f.daysSinceWork ?? -1,
          lastOpType: f.lastOpType || '',
          cumulativeGDU: f.cumulativeGDU ?? -1,
          cumulativeRainfall: f.cumulativeRainfall ?? -1,
          gduSinceLastWork: f.gduSinceLastWork ?? -1,
          rainfallSinceLastWork: f.rainfallSinceLastWork ?? -1,
        },
        geometry: f.boundary as GeoJSON.Geometry
      }))
    }
  }

  useEffect(() => {
    if (map.current || !mapContainer.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-94.5, 43.9],
      zoom: 8
    })

    map.current.on('load', () => {
      mapLoaded.current = true

      map.current!.addSource('fields', { type: 'geojson', data: toFeatures(fields) })

      map.current!.addLayer({
        id: 'fields-fill', type: 'fill', source: 'fields',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.75 }
      })

      map.current!.addLayer({
        id: 'fields-outline', type: 'line', source: 'fields',
        paint: { 'line-color': '#c8d4a0', 'line-width': 1, 'line-opacity': 0.4 }
      })

      map.current!.addLayer({
        id: 'fields-highlight', type: 'line', source: 'fields',
        paint: {
          'line-color': '#ffffff', 'line-width': 3,
          'line-opacity': ['case', ['==', ['get', 'id'], ''], 1, 0]
        }
      })

      map.current!.on('click', 'fields-fill', (e) => {
        const p = e.features?.[0]?.properties
        if (!p) return
        new mapboxgl.Popup({ maxWidth: '280px' })
          .setLngLat(e.lngLat)
          .setHTML(buildPopupHTML(p.name, p.acres, p.daysSinceWork, p.lastOpType, p.cumulativeGDU, p.cumulativeRainfall, p.gduSinceLastWork, p.rainfallSinceLastWork))
          .addTo(map.current!)
      })

      map.current!.on('mouseenter', 'fields-fill', () => { map.current!.getCanvas().style.cursor = 'pointer' })
      map.current!.on('mouseleave', 'fields-fill', () => { map.current!.getCanvas().style.cursor = '' })

      if (focusFieldId) focusOnField(focusFieldId)
    })
  }, [])

  useEffect(() => {
    if (!map.current || !mapLoaded.current) return
    const source = map.current.getSource('fields') as mapboxgl.GeoJSONSource
    if (!source) return
    source.setData(toFeatures(fields))
  }, [mode, fields])

  useEffect(() => {
    if (!map.current || !mapLoaded.current) return
    if (!focusFieldId) {
      map.current.flyTo({ center: [-94.5, 43.9], zoom: 8, duration: 1200 })
      map.current.setPaintProperty('fields-highlight', 'line-opacity',
        ['case', ['==', ['get', 'id'], ''], 1, 0])
      return
    }
    focusOnField(focusFieldId)
  }, [focusFieldId])

  function focusOnField(fieldId: string) {
    const field = fields.find(f => f.id === fieldId)
    if (!field?.boundary || !map.current) return

    map.current.setPaintProperty('fields-highlight', 'line-opacity',
      ['case', ['==', ['get', 'id'], fieldId], 1, 0])

    const geom = field.boundary as GeoJSON.Geometry
    const coords: number[][] = []
    function extractCoords(g: GeoJSON.Geometry) {
      if (g.type === 'Polygon') g.coordinates[0].forEach(c => coords.push(c as number[]))
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => poly[0].forEach(c => coords.push(c as number[])))
    }
    extractCoords(geom)
    if (coords.length === 0) return

    const lngs = coords.map(c => c[0])
    const lats = coords.map(c => c[1])
    map.current.fitBounds(
      new mapboxgl.LngLatBounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
      { padding: 80, duration: 1200 }
    )

    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2

    new mapboxgl.Popup({ closeOnClick: true, maxWidth: '280px' })
      .setLngLat([centerLng, centerLat])
      .setHTML(buildPopupHTML(
        field.name, field.acres,
        field.daysSinceWork ?? -1,
        field.lastOpType || '',
        field.cumulativeGDU ?? -1,
        field.cumulativeRainfall ?? -1,
        field.gduSinceLastWork ?? -1,
        field.rainfallSinceLastWork ?? -1
      ))
      .addTo(map.current)
  }

  return <div ref={mapContainer} style={{ width: '100%', height: '600px', borderRadius: '4px' }} />
}