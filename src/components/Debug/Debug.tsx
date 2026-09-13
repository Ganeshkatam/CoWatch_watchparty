import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { serverPath } from "../../utils/utils";
import { supabase } from "../../utils/supabaseClient";
import CountUp from "react-countup";
import { Table, PasswordInput, Button, Group, Text, Paper, Alert } from "@mantine/core";

const timeSeriesUrl = `${serverPath}/timeSeries`;
const statsUrl = `${serverPath}/stats`;

// Rendering:
// Anything that's a Record<string, number> should render as 2 column table
// e.g. counts, roomsizecounts, per shard stats
// vBrowserClientIDs etc. should be converted to key/value pairs
// vmManagerStats and currentRoomData should render in JSON blocks

const Debug = () => {
  const [operatorKey, setOperatorKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const searchParams = new URLSearchParams(window.location.search);
    const queryKey = searchParams.get("key");
    if (queryKey) {
      sessionStorage.setItem("cowatch_debug_key", queryKey);
      // Immediately scrub the secret query parameter from the browser URL bar
      window.history.replaceState({}, document.title, window.location.pathname);
      return queryKey;
    }
    return sessionStorage.getItem("cowatch_debug_key") || "";
  });

  const [inputKey, setInputKey] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [timeSeries, setTimeSeries] = useState<any[]>([]);
  const [state, setState] = useState({
    current: {} as Record<string, any>,
    last: {} as Record<string, any>,
  });

  const fetchHeaders = async (key: string): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    if (key) {
      headers["x-stats-key"] = key;
      headers["x-operator-key"] = key;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
    } catch {
      // ignore
    }
    return headers;
  };

  useEffect(() => {
    let isMounted = true;

    const fetchStats = async () => {
      try {
        const headers = await fetchHeaders(operatorKey);
        const [statsResp, timeSeriesResp] = await Promise.all([
          fetch(statsUrl, { headers }),
          fetch(timeSeriesUrl, { headers }),
        ]);

        if (statsResp.status === 403 || statsResp.status === 401) {
          if (isMounted) {
            setAuthError("Unauthorized: Operator key or admin session is required.");
          }
          return;
        }

        if (statsResp.ok && isMounted) {
          const statsJson = await statsResp.json();
          setState((prev) => ({ current: statsJson, last: prev.current }));
          setAuthError(null);
        }

        if (timeSeriesResp.ok && isMounted) {
          const tsJson = await timeSeriesResp.json();
          if (Array.isArray(tsJson)) {
            setTimeSeries(tsJson);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setAuthError(err?.message || "Failed to fetch metrics");
        }
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [operatorKey]);

  const handleSaveKey = () => {
    const trimmed = inputKey.trim();
    sessionStorage.setItem("cowatch_debug_key", trimmed);
    setOperatorKey(trimmed);
    setInputKey("");
  };

  const handleClearKey = () => {
    sessionStorage.removeItem("cowatch_debug_key");
    setOperatorKey("");
    setState({ current: {}, last: {} });
    setTimeSeries([]);
    setAuthError("Operator key cleared. Please enter a valid key.");
  };

  const rev = [...timeSeries].reverse();
  const keys = Object.keys(timeSeries.slice(-1)[0] ?? {});
  return (
    <div style={{ padding: "16px" }}>
      <Paper p="md" mb="md" withBorder style={{ backgroundColor: "var(--color-bg-secondary, #1a1b1e)" }}>
        <Group justify="space-between" align="center" wrap="wrap">
          <div>
            <Text fw={700} size="lg">CoWatch Operational Telemetry & Debug</Text>
            <Text size="xs" c="dimmed">
              Operator authentication is strictly header-based (x-stats-key / x-operator-key / JWT Bearer). No query parameters are transmitted.
            </Text>
          </div>
          <Group align="center">
            <PasswordInput
              placeholder="Enter Operator Key"
              value={inputKey}
              onChange={(e) => setInputKey(e.currentTarget.value)}
              size="xs"
              style={{ width: 220 }}
            />
            <Button size="xs" onClick={handleSaveKey} disabled={!inputKey.trim()}>
              Apply Key
            </Button>
            {operatorKey && (
              <Button size="xs" variant="outline" color="red" onClick={handleClearKey}>
                Clear Key
              </Button>
            )}
          </Group>
        </Group>
        {authError && (
          <Alert color="red" mt="sm" title="Authorization Denied">
            {authError}
          </Alert>
        )}
      </Paper>
      <div
        style={{
          display: "flex",
          overflowX: "auto",
          flexWrap: "wrap",
          flexDirection: "column",
          height: "2000px",
        }}
      >
        {Object.keys(state.current).map((k) => {
          if (k === "vmManagerStats") {
            return (
              <div style={{ overflow: "auto" }}>
                <pre style={{ fontSize: 12 }} key={k}>
                  {JSON.stringify(state.current[k], null, 2)}
                </pre>
              </div>
            );
          } else if (Array.isArray(state.current[k])) {
            // One column table
            return (
              <div
                style={{
                  maxWidth: k === "currentRoomData" ? "400px" : undefined,
                  overflow: "auto",
                }}
              >
                <Table style={{}} key={k}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{k}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {state.current[k].map((row) => {
                      return (
                        <Table.Tr>
                          <Table.Td>
                            {k === "currentRoomData" ? (
                              <div style={{ wordBreak: "break-all" }}>
                                {JSON.stringify(row, null, 2)}
                              </div>
                            ) : (
                              row
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            );
          } else {
            // Map
            return (
              <div style={{ overflow: "auto" }}>
                <Table style={{}} key={k}>
                  <Table.Thead>
                    <div>{k}</div>
                    <Table.Tr>
                      <Table.Th>Key</Table.Th>
                      <Table.Th>Value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {Object.keys(state.current[k]).map((key) => {
                      return (
                        <Table.Tr>
                          <Table.Td>{key}</Table.Td>
                          <Table.Td>
                            <CountUp
                              start={
                                state.last[k]?.[key] ?? state.current[k][key]
                              }
                              end={state.current[k][key]}
                              duration={10}
                              delay={0}
                              useEasing={false}
                            />
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            );
          }
        })}
      </div>
      {keys
        .filter((k) => k !== "time")
        .map((key) => {
          return (
            <LineChart
              width={1400}
              height={400}
              data={rev}
              margin={{
                top: 5,
                left: 20,
                bottom: 5,
              }}
            >
              <CartesianGrid />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey={key} stroke="var(--color-violet)" />
            </LineChart>
          );
        })}
    </div>
  );
};

export default Debug;
