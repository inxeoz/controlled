import { createAppointment } from "../services/appointment"

export async function createAppointmentRoute(body: { customerId: number }) {
  return createAppointment(body.customerId)
}
