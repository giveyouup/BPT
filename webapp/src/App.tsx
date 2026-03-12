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
import Audits from './pages/Audits'
import Settings from './pages/Settings'
import CptRangesPage from './pages/CptRangesPage'

function AppContent() {
  const { loading, loadError } = useData()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-gray-500 text-sm">Connecting to server…</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="max-w-sm w-full mx-4 bg-gray-900 border border-red-900/50 rounded-xl p-8 text-center">
          <div className="w-12 h-12 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-gray-100 font-semibold mb-2">Server Unreachable</h2>
          <p className="text-gray-500 text-sm mb-6">{loadError}</p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors">
            Retry
          </button>
        </div>
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
        <Route path="/audits" element={<Audits />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/cpt-ranges" element={<CptRangesPage />} />
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
