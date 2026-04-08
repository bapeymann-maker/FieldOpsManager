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
}

function getHeatColor(days: number | undefined): string {
  if (days === undefined || days === null) return '#0a0a1a' // never worked - deep cold blue
  if (days === 0)  return '#ff0000' // today - pure red
  if (days <= 3)   return '#ff1100'
  if (days <= 6)   return '#ff3300'
  if (days <= 9)   return '#ff6600'
  if (days <= 12)  return '#ff9900'
  if (days <= 15)  return '#ffcc00'
  if (days <= 18)  return '#ccdd00'
  if (days <= 21)  return '#88bb00'
  if (days <= 24)  return '#44aa22'
  if (days <= 27)  return '#228833'
  if (days <= 30)  return '#116644'
  if (days <= 33)  return '#0d5566'
  if (days <= 36)  return '#0a4488'
  if (days <= 39)  return '#0833aa'
  if (days <= 42)  return '#0622cc'
  if (days <= 45)  return '#0411dd'
  if (days <= 48)  return '#0208ee'
  if (days <= 51)  return '#0105ff'
  return '#000a2a' // 52+ days - deep cold blue
}

export default function FieldMap({ fields }: { fields: Field[] }) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (map.current || !mapContainer.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-94.5, 43.9],
      zoom: 8
    })

    map.current.on('load', () => {
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: fields
          .filter(f => f.boundary)
          .map(f => ({
            type: 'Feature',
            properties: {
              id: f.id,
              name: f.name,
              acres: f.acres,
              color: getHeatColor(f.daysSinceWork),
              daysSinceWork: f.daysSinceWork ?? -1
            },
            geometry: f.boundary as GeoJSON.Geometry
          }))
      }

      map.current!.addSource('fields', { type: 'geojson', data: geojson })

      map.current!.addLayer({
        id: 'fields-fill',
        type: 'fill',
        source: 'fields',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.7
        }
      })

      map.current!.addLayer({
        id: 'fields-outline',
        type: 'line',
        source: 'fields',
        paint: {
          'line-color': '#c8d4a0',
          'line-width': 1,
          'line-opacity': 0.5
        }
      })

      // Popup on click
      map.current!.on('click', 'fields-fill', (e) => {
        const props = e.features?.[0]?.properties
        if (!props) return
        const days = props.daysSinceWork === -1 ? 'Never worked' : `${props.daysSinceWork} days ago`
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${props.name}</strong><br/>${props.acres}ac<br/>Last worked: ${days}`)
          .addTo(map.current!)
      })

      map.current!.on('mouseenter', 'fields-fill', () => {
        map.current!.getCanvas().style.cursor = 'pointer'
      })
      map.current!.on('mouseleave', 'fields-fill', () => {
        map.current!.getCanvas().style.cursor = ''
      })
    })
  }, [fields])

  return (
    <div ref={mapContainer} style={{ width: '100%', height: '600px', borderRadius: '4px' }} />
  )
}