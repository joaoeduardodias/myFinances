import { api } from './api'

export interface Profile {
  id: string
  name: string
  email: string
}

interface Credentials {
  email: string
  password: string
}

export function signInWithPassword(credentials: Credentials) {
  return api
    .post('sessions/password', { json: credentials })
    .json<{ token: string }>()
}

export async function createUser(data: Credentials & { name: string }) {
  await api.post('users', { json: data })
}

export function getProfile() {
  return api.get('profile').json<{ user: Profile }>()
}

// O refresh token vai sozinho, no cookie `httpOnly` da API.
export async function logout() {
  await api.post('sessions/logout')
}
