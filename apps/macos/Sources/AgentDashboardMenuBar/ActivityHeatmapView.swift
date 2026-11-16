import SwiftUI

private enum HeatmapMetric: String, CaseIterable, Identifiable {
    case commits = "Commit"
    case pushes = "Push"
    case both = "Both"
    case agents = "Agents"
    case subagents = "Subagents"

    var id: String { rawValue }
}

struct ActivityHeatmapView: View {
    let days: [DashboardSnapshot.DayActivity]

    @State private var metric: HeatmapMetric = .both
    @State private var selectedDate: String?

    private var selectedDay: DashboardSnapshot.DayActivity? {
        days.first(where: { $0.date == selectedDate }) ?? days.last
    }

    private var weeks: [[DashboardSnapshot.DayActivity?]] {
        guard let first = days.first else { return [] }
        let leading = mondayIndex(first.date)
        var cells: [DashboardSnapshot.DayActivity?] = Array(repeating: nil, count: leading)
        cells.append(contentsOf: days.map(Optional.some))
        let remainder = cells.count % 7
        if remainder != 0 { cells.append(contentsOf: Array(repeating: nil, count: 7 - remainder)) }
        return stride(from: 0, to: cells.count, by: 7).map { start in
            Array(cells[start..<min(start + 7, cells.count)])
        }
    }

    var body: some View {
        let maximum = max(days.compactMap(value).max() ?? 0, 1)
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text("LAST 90 DAYS")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                selector
            }

            if days.isEmpty {
                Text("Activity history is not available yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 82)
            } else {
                HStack(alignment: .top, spacing: 4) {
                    ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                        VStack(spacing: 4) {
                            ForEach(Array(week.enumerated()), id: \.offset) { _, day in
                                if let day {
                                    dayButton(day, maximum: maximum)
                                } else {
                                    Color.clear.frame(width: 16, height: 16)
                                }
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .center)

                if let selectedDay {
                    selectedDayBar(selectedDay)
                }
            }
        }
        .padding(11)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 11))
        .overlay {
            RoundedRectangle(cornerRadius: 11)
                .stroke(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }

    private var selector: some View {
        HStack(spacing: 2) {
            ForEach(HeatmapMetric.allCases) { option in
                Button {
                    metric = option
                } label: {
                    Text(option.rawValue)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .background(
                    Color.primary.opacity(metric == option ? 0.16 : 0),
                    in: RoundedRectangle(cornerRadius: 5)
                )
                .accessibilityAddTraits(metric == option ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 7))
        .accessibilityLabel("Heatmap metric")
    }

    private func dayButton(_ day: DashboardSnapshot.DayActivity, maximum: Double) -> some View {
        let count = value(day)
        let opacity = count.map { $0 == 0 ? 0.06 : 0.16 + sqrt($0 / maximum) * 0.66 } ?? 0.02
        let description = dayDescription(day)
        return Button { selectedDate = day.date } label: {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color.white.opacity(opacity))
                .frame(width: 16, height: 16)
                .overlay {
                    if count == nil {
                        RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(Color.primary.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                    }
                    if selectedDay?.date == day.date {
                        RoundedRectangle(cornerRadius: 3)
                            .stroke(Color.white.opacity(0.9), lineWidth: 1.5)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(formatted(day.date))
        .accessibilityValue(description)
        .accessibilityAddTraits(selectedDay?.date == day.date ? .isSelected : [])
        .help("\(formatted(day.date)) · \(description)")
    }

    private func selectedDayBar(_ day: DashboardSnapshot.DayActivity) -> some View {
        HStack(spacing: 8) {
            Text(formatted(day.date)).font(.caption.weight(.semibold))
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(amount(day.commits)) commits · \(amount(day.pushes)) pushes")
                Text("\(amount(day.agents)) agents · \(amount(day.subagents)) subagents")
            }
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 7))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(formatted(day.date))
        .accessibilityValue(dayDescription(day))
    }

    private func value(_ day: DashboardSnapshot.DayActivity) -> Double? {
        switch metric {
        case .commits: return day.commits
        case .pushes: return day.pushes
        case .both:
            guard let commits = day.commits, let pushes = day.pushes else { return nil }
            return commits + pushes
        case .agents: return day.agents
        case .subagents: return day.subagents
        }
    }

    private func amount(_ count: Double?) -> String {
        count?.formatted(.number.precision(.fractionLength(0))) ?? "—"
    }

    private func dayDescription(_ day: DashboardSnapshot.DayActivity) -> String {
        [(day.commits, "commits"), (day.pushes, "pushes"), (day.agents, "agents"), (day.subagents, "subagents")]
            .map { count, label in count == nil ? "\(label) unavailable" : "\(amount(count)) \(label)" }
            .joined(separator: ", ")
    }

    private func mondayIndex(_ date: String) -> Int {
        let values = date.split(separator: "-").compactMap { Int($0) }
        guard values.count == 3 else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let instant = calendar.date(from: DateComponents(year: values[0], month: values[1], day: values[2]))!
        return (calendar.component(.weekday, from: instant) + 5) % 7
    }

    private func formatted(_ date: String) -> String {
        ActivityDayLabel.formatted(date)
    }
}

enum ActivityDayLabel {
    static func formatted(_ date: String, locale: Locale = .current) -> String {
        let values = date.split(separator: "-").compactMap { Int($0) }
        guard values.count == 3 else { return date }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let instant = calendar.date(from: DateComponents(year: values[0], month: values[1], day: values[2])) else {
            return date
        }
        // These are already local calendar dates from the ledger, not UTC events.
        // Use the same neutral zone to format them so the Mac's zone cannot shift a day.
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
            .month(.abbreviated).day()
        return instant.formatted(style)
    }
}
