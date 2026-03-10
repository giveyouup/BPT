import { Routes, Route, Navigate } from 'react-router-dom'
import { DataProvider, useData } from './context/DataContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import MonthlyDetail from './pages/MonthlyDetail'
import CalendarMonthDetail from './pages/CalendarMonthDetail'
import AnnualSummary from './pages/AnnualSummary'
import StipendCalculator from './pages/StipendCalculator'
import ScheduleCalendar from './pages/ScheduleCalendar'
import Settings from './pages/Settings'

function AppContent() {
  const { loading } = useData()
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/month/:id" element={<MonthlyDetail />} />
        <Route path="/calendar/:yearMonth" element={<CalendarMonthDetail />} />
        <Route path="/annual/:year" element={<AnnualSummary />} />
        <Route path="/annual" element={<AnnualSummary />} />
        <Route path="/stipends" element={<StipendCalculator />} />
        <Route path="/schedule" element={<ScheduleCalendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <DataProvider>
      <AppContent />
    </DataProvider>
  )
}
