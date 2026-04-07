import { supabase } from './supabase'

export async function getFields() {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
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