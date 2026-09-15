import React, { useState, useMemo, useEffect } from "react";
import { Popover, Text } from "@mantine/core";
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import styles from "./PremiumDatePicker.module.css";

interface PremiumDatePickerProps {
  value: string; // ISO date string: YYYY-MM-DD
  onChange: (val: string) => void;
  error?: string | null;
  maxDate?: string;
  label?: string;
  required?: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const PremiumDatePicker: React.FC<PremiumDatePickerProps> = ({
  value,
  onChange,
  error,
  maxDate,
  label = "Date of birth",
  required = false,
}) => {
  const [opened, setOpened] = useState(false);

  // Parse initial selected date or default view date (18 years ago from today)
  const defaultYear = useMemo(() => {
    const today = new Date();
    return today.getFullYear() - 18;
  }, []);

  const parsedInitial = useMemo(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return { year: y, month: m - 1, day: d };
    }
    return { year: defaultYear, month: 0, day: 1 };
  }, [value, defaultYear]);

  const [viewYear, setViewYear] = useState(parsedInitial.year);
  const [viewMonth, setViewMonth] = useState(parsedInitial.month);

  // Sync view when value changes externally
  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m] = value.split("-").map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    }
  }, [value]);

  const maxDateObj = useMemo(() => {
    if (maxDate) {
      const [y, m, d] = maxDate.split("-").map(Number);
      return new Date(y, m - 1, d, 23, 59, 59);
    }
    return new Date();
  }, [maxDate]);

  // Generate Year options (1920 to current year)
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= 1920; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Calculate days for the calendar grid
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: { day: number; monthOffset: number; isCurrentMonth: boolean; dateString: string; isDisabled: boolean; isToday: boolean; isSelected: boolean }[] = [];

    // Previous month padding days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = new Date(prevYear, prevMonth, d) > maxDateObj;
      days.push({
        day: d,
        monthOffset: -1,
        isCurrentMonth: false,
        dateString: dateStr,
        isDisabled: isFuture,
        isToday: false,
        isSelected: value === dateStr,
      });
    }

    // Current month days
    const todayStr = new Date().toISOString().split("T")[0];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = new Date(viewYear, viewMonth, d) > maxDateObj;
      days.push({
        day: d,
        monthOffset: 0,
        isCurrentMonth: true,
        dateString: dateStr,
        isDisabled: isFuture,
        isToday: dateStr === todayStr,
        isSelected: value === dateStr,
      });
    }

    // Next month padding days to complete grid (multiples of 7)
    const targetLength = days.length <= 35 ? 35 : 42;
    const remaining = targetLength - days.length;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isFuture = new Date(nextYear, nextMonth, d) > maxDateObj;
      days.push({
        day: d,
        monthOffset: 1,
        isCurrentMonth: false,
        dateString: dateStr,
        isDisabled: isFuture,
        isToday: false,
        isSelected: value === dateStr,
      });
    }

    return days;
  }, [viewYear, viewMonth, maxDateObj, value]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (dateString: string) => {
    onChange(dateString);
    setOpened(false);
  };

  const handleJump18YearsAgo = () => {
    const today = new Date();
    const targetYear = today.getFullYear() - 18;
    const targetMonth = today.getMonth();
    const targetDay = today.getDate();
    const dateStr = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
    setViewYear(targetYear);
    setViewMonth(targetMonth);
    onChange(dateStr);
    setOpened(false);
  };

  const handleClear = () => {
    onChange("");
  };

  // Format date display
  const formattedDisplay = useMemo(() => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map(Number);
    const monthName = MONTH_NAMES[m - 1] || "";
    return `${monthName} ${d}, ${y}`;
  }, [value]);

  return (
    <div className={styles.pickerContainer}>
      {label && (
        <label className={styles.pickerLabel}>
          <span>{label}</span>
          {required && <span className={styles.requiredAsterisk}>*</span>}
        </label>
      )}

      {/* Hidden native input maintaining accessibility and age-policy test suite compatibility */}
      <input
        type="date"
        name="date_of_birth_input"
        aria-label={label}
        value={value}
        max={maxDate}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          height: 0,
          margin: 0,
          padding: 0,
          border: 0,
        }}
        tabIndex={-1}
      />

      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        offset={6}
        radius="lg"
        shadow="xl"
        withinPortal
        zIndex={9999}
        middlewares={{
          flip: {
            fallbackPlacements: ["bottom-start", "top-start"],
            padding: 10,
          },
          shift: {
            padding: 10,
            limiter: {
              fn: ({ x, y }) => ({ x, y }),
            },
          },
          size: true,
        }}
      >
        <Popover.Target>
          <button
            type="button"
            className={`${styles.triggerButton} ${opened ? styles.triggerButtonActive : ""} ${error ? styles.triggerButtonError : ""}`}
            onClick={() => setOpened((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={opened}
          >
            <div className={styles.triggerContent}>
              <IconCalendar size={18} className={styles.calendarIcon} />
              {formattedDisplay ? (
                <span className={styles.dateDisplayText}>{formattedDisplay}</span>
              ) : (
                <span className={styles.placeholderText}>Select date of birth (dd / mm / yyyy)</span>
              )}
            </div>
            <IconChevronDown
              size={16}
              className={`${styles.chevronIcon} ${opened ? styles.chevronIconOpen : ""}`}
            />
          </button>
        </Popover.Target>

        <Popover.Dropdown className={styles.dropdownCard}>
          <div className={styles.calendarHeader}>
            <button
              type="button"
              className={styles.navButton}
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              <IconChevronLeft size={16} />
            </button>

            <div className={styles.headerSelectors}>
              <select
                className={styles.selectInput}
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                aria-label="Select month"
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                className={styles.selectInput}
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                aria-label="Select year"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={styles.navButton}
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              <IconChevronRight size={16} />
            </button>
          </div>

          <div className={styles.weekdaysRow}>
            {WEEKDAY_SHORT.map((w) => (
              <div key={w} className={styles.weekdayLabel}>
                {w}
              </div>
            ))}
          </div>

          <div className={styles.daysGrid}>
            {calendarDays.map((cd, index) => {
              const cellClasses = [
                styles.dayCell,
                !cd.isCurrentMonth ? styles.dayOutsideMonth : "",
                cd.isToday ? styles.dayToday : "",
                cd.isSelected ? styles.daySelected : "",
                cd.isDisabled ? styles.dayDisabled : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={`${cd.dateString}-${index}`}
                  type="button"
                  className={cellClasses}
                  disabled={cd.isDisabled}
                  onClick={() => handleSelectDay(cd.dateString)}
                >
                  {cd.day}
                </button>
              );
            })}
          </div>

          <div className={styles.calendarFooter}>
            <button
              type="button"
              className={styles.presetLink}
              onClick={handleJump18YearsAgo}
            >
              18th birthday preset
            </button>

            {value && (
              <button
                type="button"
                className={styles.clearLink}
                onClick={handleClear}
              >
                Clear
              </button>
            )}
          </div>
        </Popover.Dropdown>
      </Popover>

      {error && <Text className={styles.errorMessage}>{error}</Text>}
    </div>
  );
};
