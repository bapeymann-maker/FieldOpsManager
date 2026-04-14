import { supabase } from './supabase'

export async function getFields() {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .order('client')
    .order('region')
    .order('name')
  if (error) throw error
  return data
}

export async function getOperations(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('operations')
    .select(`
      *,
      fields(name),
      operation_types(name, color)
    `)
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) throw error
  return data
}

export async function getOperationTypes() {
  const { data, error } = await supabase
    .from('operation_types')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}
export async function getGDUByDate(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('gdu_daily')
    .select('field_id, date, daily_gdu, cumulative_gdu, cumulative_rainfall, rainfall_inches, crop_type')
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) throw error
  return data || []
}

export async function getLatestGDUPerField(fieldIds: string[]) {
  const { data, error } = await supabase
    .from('gdu_daily')
    .select('field_id, date, daily_gdu, cumulative_gdu, cumulative_rainfall, rainfall_inches, crop_type')
    .in('field_id', fieldIds)
    .order('date', { ascending: false })
  if (error) throw error

  // Return most recent record per field
  const latest: Record<string, typeof data[0]> = {}
  for (const row of data || []) {
    if (!latest[row.field_id]) latest[row.field_id] = row
  }
  return latest
}