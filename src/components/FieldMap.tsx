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
  if (days === undefined || days === null) return '#2a3020' // never worked - dark
  if (days <= 1)  return '#ff2200' // today - hot red
  if (days <= 7)  return '#ff6600' // this week - orange
  if (days <= 14) return '#ffaa00' // two weeks - yellow
  if (days <= 30) return '#88cc00' // month - yellow green
  if (days <= 60) return '#226622' // two months - green
  return '#1a3a1a'                  // old - cold dark green
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