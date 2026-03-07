import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import MonthlyDetail from './pages/MonthlyDetail'
import CalendarMonthDetail from './pages/CalendarMonthDetail'
import AnnualSummary from './pages/AnnualSummary'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/month/:id" element={<MonthlyDetail />} />
        <Route path="/calendar/:yearMonth" element={<CalendarMonthDetail />} />
        <Route path="/annual/:year" element={<AnnualSummary />} />
        <Route path="/annual" element={<AnnualSummary />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
