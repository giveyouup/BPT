import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { formatMonthYear } from '../utils/dateUtils'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { reports, physicians, activePhysicianId, setActivePhysicianId } = useData()
  const navigate = useNavigate()
  const [physicianMenuOpen, setPhysicianMenuOpen] = useState(false)
  const physicianMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (physicianMenuRef.current && !physicianMenuRef.current.contains(e.target as Node)) {
        setPhysicianMenuOpen(false)
      }
    }
    if (physicianMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [physicianMenuOpen])

  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? new Date().getFullYear())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [headerHidden, setHeaderHidden] = useState(false)
  const lastScrollY = useRef(0)
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()

  // Hide header on scroll down, reveal on scroll up
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const handler = () => {
      const y = el.scrollTop
      if (y > lastScrollY.current && y > 48) setHeaderHidden(true)
      else if (y < lastScrollY.current) setHeaderHidden(false)
      lastScrollY.current = y
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [])

  // Reveal header on route change
  useEffect(() => { setHeaderHidden(false) }, [location.pathname])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      desktopCollapsed ? 'md:justify-center md:px-2' : ''
    } ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-400'
        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
    }`

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Mobile top bar */}
      <div className={`md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 h-12 bg-gray-900 border-b border-gray-800 transition-transform duration-300 ${headerHidden ? '-translate-y-full' : 'translate-y-0'}`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-gray-400 hover:text-gray-100 transition-colors"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">BRACT</span>
      </div>

      {/* Backdrop overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-40 md:z-auto
        h-full flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col
        transition-all duration-200
        w-56
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${desktopCollapsed ? 'md:w-12' : 'md:w-56'}
      `}>
        {/* Header */}
        <div className="px-4 py-5 border-b border-gray-800 flex items-center justify-between min-h-[72px]">
          {/* BRACT title — hidden on desktop when collapsed */}
          <div className={desktopCollapsed ? 'hidden' : ''}>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">BRACT</h1>
            <p className="text-xs text-gray-500 mt-0.5">Bijan's Revenue &amp; Anesthesia Comp Tracker</p>
          </div>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setDesktopCollapsed((c) => !c)}
            className={`hidden md:flex items-center justify-center text-gray-600 hover:text-gray-300 transition-colors rounded-md p-1 hover:bg-gray-800 ${
              desktopCollapsed ? 'mx-auto' : ''
            }`}
            aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {desktopCollapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>

          {/* Mobile close button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-gray-600 hover:text-gray-400 transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto flex flex-col">
          <NavLink to="/" end onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Dashboard</span>
          </NavLink>

          {reports.length > 0 && (
            <NavLink to={`/annual/${years[0]}`} onClick={() => setSidebarOpen(false)} className={navLinkClass}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className={desktopCollapsed ? 'md:hidden' : ''}>Annual Summary</span>
            </NavLink>
          )}

          <NavLink to="/compensation" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Compensation</span>
          </NavLink>

          <NavLink to="/stipends" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Stipend Calc</span>
          </NavLink>

          <NavLink to="/schedule" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Schedule</span>
          </NavLink>

          <NavLink to="/audits" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Audits</span>
          </NavLink>

          <NavLink to="/upload" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Upload Report</span>
          </NavLink>

          <NavLink to="/settings" onClick={() => setSidebarOpen(false)} className={navLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className={desktopCollapsed ? 'md:hidden' : ''}>Settings</span>
          </NavLink>

          {/* PCR Reports list — hidden on desktop when collapsed */}
          {reports.length > 0 && (
            <div className={`pt-4 flex flex-col min-h-0 flex-1 ${desktopCollapsed ? 'md:hidden' : ''}`}>
              <div className="flex items-center justify-between px-3 mb-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">PCR Reports</p>
                {years.length > 1 && (
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="overflow-y-auto">
                {reports
                  .filter((r) => r.year === selectedYear)
                  .slice()
                  .reverse()
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { navigate(`/month/${r.id}`); setSidebarOpen(false) }}
                      className="w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-gray-500 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                      {formatMonthYear(r.year, r.month)}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {/* Physician selector — pinned at nav bottom */}
          {physicians.length > 0 && (
            <div className="mt-auto pt-3 border-t border-gray-800" ref={physicianMenuRef}>
              <div className="relative">
                {desktopCollapsed ? (
                  /* Collapsed: avatar-only button, dropdown opens to the right */
                  <>
                    <button
                      onClick={() => setPhysicianMenuOpen((o) => !o)}
                      title={physicians.find((p) => p.id === activePhysicianId)?.name ?? 'Select physician'}
                      className="hidden md:flex w-full items-center justify-center py-2 rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                    >
                      <span className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">
                        {(physicians.find((p) => p.id === activePhysicianId)?.name ?? '?')[0].toUpperCase()}
                      </span>
                    </button>
                    {physicianMenuOpen && (
                      <div className="hidden md:block absolute bottom-0 left-full ml-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 min-w-36">
                        {physicians.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setActivePhysicianId(p.id); setPhysicianMenuOpen(false) }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                              p.id === activePhysicianId
                                ? 'bg-indigo-600/20 text-indigo-300'
                                : 'text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            <span className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                              {p.name[0].toUpperCase()}
                            </span>
                            <span className="truncate">{p.name}</span>
                            {p.id === activePhysicianId && (
                              <svg className="w-3 h-3 ml-auto text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
                {/* Expanded (desktop or mobile): full name row */}
                <button
                  onClick={() => setPhysicianMenuOpen((o) => !o)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors ${desktopCollapsed ? 'md:hidden' : ''}`}
                >
                  <span className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {(physicians.find((p) => p.id === activePhysicianId)?.name ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="flex-1 text-left truncate">
                    {physicians.find((p) => p.id === activePhysicianId)?.name ?? 'Select physician'}
                  </span>
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {physicianMenuOpen && !desktopCollapsed && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 md:block">
                    {physicians.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setActivePhysicianId(p.id); setPhysicianMenuOpen(false) }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                          p.id === activePhysicianId
                            ? 'bg-indigo-600/20 text-indigo-300'
                            : 'text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                          {p.name[0].toUpperCase()}
                        </span>
                        <span className="truncate">{p.name}</span>
                        {p.id === activePhysicianId && (
                          <svg className="w-3 h-3 ml-auto text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </nav>
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="flex-1 overflow-y-auto pt-12 md:pt-0">
        {children}
      </main>
    </div>
  )
}
