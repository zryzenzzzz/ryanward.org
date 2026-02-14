import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          prompt: () => void;
          renderButton: (
            element: HTMLElement,
            config: { theme: string; size: string; shape: string; text?: string }
          ) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token: string }) => void;
          }) => {
            requestAccessToken: () => void;
          };
        };
      };
    };
  }
}

interface UserInfo {
  name: string;
  email: string;
  picture: string;
}

function decodeJwt(token: string): UserInfo {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}

export function App() {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [spreadsheetLink, setSpreadsheetLink] = useState("");
  const [spreadsheetLinked, setSpreadsheetLinked] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  // Canvas State
  const [canvasToken, setCanvasToken] = useState("");
  const [canvasDomain, setCanvasDomain] = useState("canvas.instructure.com");
  const [canvasConnected, setCanvasConnected] = useState(false);

  // Google API State
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const CLIENT_ID = "346581259871-mb5b7plclk8rjkt1ud7l0q0b6o8poec3.apps.googleusercontent.com";

  const [googleLoaded, setGoogleLoaded] = useState(false);

  useEffect(() => {
    const initializeGoogle = () => {
      if (window.google && googleButtonRef.current && !user) {
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredentialResponse,
        });
        
                  window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "signup_with",
        });
        setGoogleLoaded(true);
      }
    };

    if (window.google) {
      initializeGoogle();
    } else {
      const checkGoogle = setInterval(() => {
        if (window.google) {
          clearInterval(checkGoogle);
          initializeGoogle();
        }
      }, 100);
      setTimeout(() => clearInterval(checkGoogle), 5000);
      return () => clearInterval(checkGoogle);
    }
  }, [user]);

  const handleCredentialResponse = (response: { credential: string }) => {
    const userInfo = decodeJwt(response.credential);
    setUser(userInfo);
  };

  const handleSignOut = () => {
    setUser(null);
    setAccessToken(null);
    setShowUserMenu(false);
    setSpreadsheetLinked(false);
  };

  const requestGoogleScopes = () => {
    if (window.google) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        callback: (response) => {
          if (response.access_token) {
            setAccessToken(response.access_token);
            setSpreadsheetLinked(true);
            setSyncStatus("Connected to Google Sheets");
          }
        },
      });
      client.requestAccessToken();
    }
  };

  const handleFiles = (file: File) => {
    setFileName(`Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length) handleFiles(files[0]);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length) {
      handleFiles(e.target.files[0]);
    }
  };

  const handleCanvasConnect = () => {
    if (canvasToken && canvasDomain) {
      setCanvasConnected(true);
      setSyncStatus("Canvas credentials saved");
    } else {
      alert("Please enter both domain and token");
    }
  };

  const extractSheetId = (url: string) => {
    const match = url.match(/\/d\/(.*?)(\/|$)/);
    return match ? match[1] : null;
  };

  const syncData = async () => {
    if (!canvasConnected || !accessToken || !spreadsheetLink) {
      alert("Please connect both Canvas and Google Sheets first.");
      return;
    }

    const sheetId = extractSheetId(spreadsheetLink);
    if (!sheetId) {
      alert("Invalid Google Sheet URL");
      return;
    }

    setIsSyncing(true);
    setSyncStatus("Fetching data from Canvas...");

    try {
      // 1. Fetch Courses from Canvas
      // Note: This requires a proxy or disabled CORS in browser for localhost
      const coursesResponse = await fetch(`https://${canvasDomain}/api/v1/courses?per_page=100`, {
        headers: { Authorization: `Bearer ${canvasToken}` },
      });

      if (!coursesResponse.ok) throw new Error("Failed to fetch courses. Check CORS/Token.");
      
      const courses = await coursesResponse.json();
      const activeCourses = courses.filter((c: any) => !c.access_restricted_by_date);
      
      let allAssignments: any[] = [];
      setSyncStatus(`Found ${activeCourses.length} courses. Fetching assignments...`);

      // 2. Fetch Assignments for each course
      for (const course of activeCourses) {
        const assignResponse = await fetch(`https://${canvasDomain}/api/v1/courses/${course.id}/assignments?per_page=50`, {
          headers: { Authorization: `Bearer ${canvasToken}` },
        });
        if (assignResponse.ok) {
          const assignments = await assignResponse.json();
          const courseAssignments = assignments.map((a: any) => ({
            course: course.name,
            name: a.name,
            due_at: a.due_at || "No Due Date",
            points: a.points_possible || 0,
            url: a.html_url
          }));
          allAssignments = [...allAssignments, ...courseAssignments];
        }
      }

      setSyncStatus(`Writing ${allAssignments.length} assignments to Sheets...`);

      // 3. Write to Google Sheets
      const values = [
        ["Course", "Assignment", "Due Date", "Points", "Link"],
        ...allAssignments.map(a => [a.course, a.name, a.due_at, a.points, a.url])
      ];

      const writeResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:E${values.length}?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      });

      if (!writeResponse.ok) throw new Error("Failed to write to Sheets");

      setSyncStatus("Sync Complete! ✅");
      setTimeout(() => setSyncStatus(""), 3000);

    } catch (error: any) {
      console.error(error);
      setSyncStatus("Error: " + (error.message || "Failed to sync"));
      alert("Sync failed. If seeing CORS error, you may need a browser extension to allow cross-origin requests from localhost to Canvas.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center"
      style={{
        fontFamily: "'Inter', -apple-system, sans-serif",
        background: "linear-gradient(180deg, #ffffff 0%, #f1f8f6 100%)",
        color: "#1a202c",
      }}
    >
      {/* Navigation */}
      <nav className="flex w-full max-w-[1200px] items-center justify-between px-5 py-5 box-border">
        {/* Back Arrow */}
        <div className="relative inline-flex items-center">
          <a
            href="https://ryanward.org"
            className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-200"
            style={{ color: "#64748b" }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            title="Go back"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200"
              style={{
                transform: showTooltip ? "translateX(-2px)" : "translateX(0)",
              }}
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </a>
          <span
            className="ml-1 text-xs font-medium transition-all duration-200"
            style={{
              color: "#94a3b8",
              opacity: showTooltip ? 1 : 0,
              transform: showTooltip ? "translateX(0)" : "translateX(-4px)",
            }}
          >
            Go back
          </span>
        </div>

        {/* Instructions / Canvas Setup Dropdown */}
        <div className="relative">
          <button
            className="flex items-center gap-2 rounded-[30px] border px-6 py-2 cursor-pointer text-sm font-medium transition-all duration-200"
            style={{
              background: canvasConnected ? "#f0fdf4" : "white",
              boxShadow: "0 4px 15px rgba(0,0,0,0.05)",
              borderColor: canvasConnected ? "#86efac" : "#e2e8f0",
              color: canvasConnected ? "#15803d" : "#4a5568",
            }}
            onClick={() => setShowInstructions(!showInstructions)}
          >
            {canvasConnected ? "Canvas Connected" : "Connect Canvas"}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: showInstructions ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Canvas Setup Dropdown Content */}
          {showInstructions && (
            <div
              className="absolute top-full left-1/2 mt-3 w-[400px] rounded-xl border p-5 text-left text-sm z-50"
              style={{
                transform: "translateX(-50%)",
                background: "white",
                boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
                borderColor: "#e2e8f0",
                color: "#4a5568",
              }}
            >
              <h3 className="text-base font-semibold mb-3" style={{ color: "#1a202c" }}>
                Canvas Configuration
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-gray-500">Canvas Domain</label>
                  <input 
                    type="text" 
                    value={canvasDomain}
                    onChange={(e) => setCanvasDomain(e.target.value)}
                    placeholder="e.g. canvas.instructure.com"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-gray-500">
                    API Access Token 
                    <a href="https://community.canvaslms.com/t5/Student-Guide/How-do-I-manage-API-access-tokens-as-a-student/ta-p/273" target="_blank" className="ml-2 text-blue-500 hover:underline">(How to get?)</a>
                  </label>
                  <input 
                    type="password" 
                    value={canvasToken}
                    onChange={(e) => setCanvasToken(e.target.value)}
                    placeholder="Paste your Canvas API Token here"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <button 
                  onClick={handleCanvasConnect}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Save Configuration
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  We recommend using this on a secure device. Your token is used only to fetch your assignments.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Login / User Profile */}
        <div className="relative">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 cursor-pointer bg-transparent border-none p-0"
              >
                <img
                  src={user.picture}
                  alt={user.name}
                  className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-md transition-transform duration-200 hover:scale-105"
                  referrerPolicy="no-referrer"
                />
              </button>
              
              {showUserMenu && (
                <div
                  className="absolute top-full right-0 mt-2 w-56 rounded-xl border p-4 z-50"
                  style={{
                    background: "white",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
                    borderColor: "#e2e8f0",
                  }}
                >
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b" style={{ borderColor: "#e2e8f0" }}>
                    <img
                      src={user.picture}
                      alt={user.name}
                      className="w-10 h-10 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "#1a202c" }}>
                        {user.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "#64748b" }}>
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-150 hover:bg-gray-100"
                    style={{ color: "#64748b", background: "transparent", border: "none" }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative">
              <div ref={googleButtonRef} />
              {!googleLoaded && (
                <button
                  className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium cursor-pointer transition-all duration-200 hover:shadow-md"
                  style={{
                    background: "white",
                    borderColor: "#e2e8f0",
                    color: "#4a5568",
                  }}
                  onClick={() => {
                    if (window.google) window.google.accounts.id.prompt();
                  }}
                >
                  Sign in / Sign up with Google
                </button>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <main className="mt-12 w-[90%] text-center">
        <h1
          className="mb-10 text-5xl font-extrabold"
          style={{ letterSpacing: "-1px" }}
        >
          Automate Your Learning Logs
        </h1>

        {/* Drop Zone - Split in Two */}
        <div
          className="mx-auto max-w-[900px] rounded-3xl border p-8"
          style={{
            background: "white",
            boxShadow: "0 20px 40px rgba(0,0,0,0.03)",
            borderColor: "#f0f0f0",
          }}
        >
          <div className="flex items-stretch flex-col md:flex-row gap-8 md:gap-0">
            {/* Left Side - File Upload */}
            <div
              className="flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-12 transition-all duration-300"
              style={{
                borderColor: dragOver ? "#1a73e8" : "#cbd5e1",
                background: dragOver ? "#f0f7ff" : "transparent",
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-3"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-sm text-gray-500 mb-1">Drop file here to upload</p>
              <input
                type="file"
                ref={fileInputRef}
                hidden
                onChange={handleFileChange}
              />
              <button
                className="my-3 flex cursor-pointer items-center gap-2 rounded-xl border-none px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:shadow-lg"
                style={{ background: "#1a73e8" }}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload from your device
              </button>
              <div
                className="text-xs"
                style={{
                  color: fileName ? "#10b981" : "#94a3b8",
                  fontWeight: fileName ? 700 : 400,
                }}
              >
                {fileName || "Add CSV file"}
              </div>
            </div>

            {/* Dotted Divider */}
            <div
              className="hidden md:block mx-6 w-px self-stretch"
              style={{
                borderLeft: "2px dashed #cbd5e1",
              }}
            />

            {/* Right Side - Link Spreadsheet / Sync */}
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-12">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke={spreadsheetLinked ? "#10b981" : "#94a3b8"}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-3"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <p className="text-sm text-gray-500 mb-3 font-medium">Link Spreadsheet</p>
              
              <input
                type="text"
                placeholder="Paste Google Sheets URL..."
                value={spreadsheetLink}
                onChange={(e) => setSpreadsheetLink(e.target.value)}
                disabled={spreadsheetLinked}
                className="w-full max-w-[240px] px-4 py-2.5 text-sm border rounded-lg mb-3 outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
                style={{ borderColor: "#e2e8f0" }}
              />
              
              {spreadsheetLinked ? (
                <button
                  className="flex cursor-pointer items-center gap-2 rounded-xl border-none px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg disabled:opacity-70"
                  style={{ background: isSyncing ? "#64748b" : "#10b981" }}
                  onClick={syncData}
                  disabled={isSyncing}
                >
                   {isSyncing ? "Syncing..." : "Sync Canvas Data"}
                </button>
              ) : (
                <button
                  className="flex cursor-pointer items-center gap-2 rounded-xl border-none px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:shadow-lg"
                  style={{ background: "#1a73e8" }}
                  onClick={requestGoogleScopes}
                >
                  Connect Spreadsheet
                </button>
              )}
              
              <div className="text-xs mt-3 h-4" style={{ color: syncStatus.includes("Error") ? "#ef4444" : "#94a3b8" }}>
                {syncStatus || (spreadsheetLinked ? "Ready to sync" : "Google Sheets integration")}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Partner Logos */}
      <div className="mt-20 mb-16 flex flex-wrap items-center justify-center gap-20 px-8">
        <img
          src="https://github.com/zryzenzzzz/ryanward.org/blob/main/Pics/Davinci.png?raw=true"
          alt="DaVinci"
          className="h-24 w-auto object-contain transition-transform duration-200 hover:scale-105"
        />
        <img
          src="https://github.com/zryzenzzzz/ryanward.org/blob/main/Pics/Canvas.png?raw=true"
          alt="Canvas"
          className="h-24 w-auto object-contain transition-transform duration-200 hover:scale-105"
        />
        <img
          src="https://github.com/zryzenzzzz/ryanward.org/blob/main/Pics/Googlesheets.png?raw=true"
          alt="Google Sheets"
          className="h-24 w-auto object-contain transition-transform duration-200 hover:scale-105"
        />
      </div>
    </div>
  );
}
