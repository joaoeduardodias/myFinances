import { createBrowserRouter } from 'react-router-dom'

import { AppLayout } from '@/components/app-layout'
import { ProtectedRoute } from '@/components/protected-route'
import { AnalysisPage } from '@/pages/analysis'
import { CardDetail } from '@/pages/card-detail'
import { Cards } from '@/pages/cards'
import { Connections } from '@/pages/connections'
import { Home } from '@/pages/home'
import { Login } from '@/pages/login'
import { PayslipDetail } from '@/pages/payslip-detail'
import { Payslips } from '@/pages/payslips'
import { Recurring } from '@/pages/recurring'
import { Register } from '@/pages/register'
import { Transactions } from '@/pages/transactions'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/transacoes', element: <Transactions /> },
          { path: '/analise', element: <AnalysisPage /> },
          { path: '/cartoes', element: <Cards /> },
          { path: '/cartoes/:id', element: <CardDetail /> },
          { path: '/recorrentes', element: <Recurring /> },
          { path: '/holerites', element: <Payslips /> },
          { path: '/holerites/:id', element: <PayslipDetail /> },
          { path: '/conexoes', element: <Connections /> },
        ],
      },
    ],
  },
])
