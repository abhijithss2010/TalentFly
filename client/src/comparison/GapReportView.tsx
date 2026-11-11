import type { RunReportEntry } from './run-result';

const STATUS_LABELS = { met: 'Met', weak: 'Weak', missing: 'Missing' } as const;

/**
 * Shows one saved gap report. Quoted evidence is only presented as a quote when the app found
 * it in the resume; anything else is labelled unverified. Nothing here edits a resume.
 */
export function GapReportView({ entry }: { entry: RunReportEntry }) {
  const { report } = entry;
  const tokens = [
    entry.usage.inputTokens !== undefined ? `${entry.usage.inputTokens.toLocaleString()} in` : '',
    entry.usage.outputTokens !== undefined ? `${entry.usage.outputTokens.toLocaleString()} out` : '',
  ].filter(Boolean);

  return (
    <article className="gap-report" aria-label={`Report for ${entry.resumeName}`}>
      <header className="gap-report-header">
        <h5>{entry.resumeName}</h5>
        <p className="gap-report-score">
          <strong>{report.matchScore}</strong>
          <span>/100 match</span>
        </p>
      </header>
      <p>{report.summary}</p>

      {report.requirements.length > 0 && (
        <section aria-label="Requirements">
          <h6>Requirements</h6>
          <ul className="gap-requirements">
            {report.requirements.map((item, index) => (
              <li key={`${item.requirement}-${index}`}>
                <span className={`gap-status gap-status-${item.status}`}>
                  {STATUS_LABELS[item.status]}
                </span>
                <span>{item.requirement}</span>
                {item.evidence &&
                  (item.evidenceVerified ? (
                    <blockquote>“{item.evidence}”</blockquote>
                  ) : (
                    <p className="gap-unverified">
                      Unverified: the model cited “{item.evidence}”, which was not found in this
                      resume.
                    </p>
                  ))}
                {item.note && <small>{item.note}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.keywordGaps.length > 0 && (
        <section aria-label="Keyword gaps">
          <h6>Keywords from the job missing in this resume</h6>
          <ul className="gap-keywords">
            {report.keywordGaps.map((keyword) => (
              <li key={keyword}>{keyword}</li>
            ))}
          </ul>
        </section>
      )}

      {report.suggestions.length > 0 && (
        <section aria-label="Suggestions">
          <h6>Suggestions</h6>
          <p className="muted-copy">
            Suggestions are ideas only. TalentFly never changes your resume.
          </p>
          <ul className="gap-suggestions">
            {report.suggestions.map((item, index) => (
              <li key={`${item.suggestion}-${index}`}>
                {item.section && <strong>{item.section}: </strong>}
                {item.suggestion}
                {item.unverified ? (
                  <p className="gap-unverified">
                    Unverified: not based on text found in your resume. Use it only if it is true.
                  </p>
                ) : (
                  <blockquote>Based on: “{item.evidence}”</blockquote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="gap-report-footer">
        <span>{entry.model}</span>
        {tokens.length > 0 && <span>{tokens.join(' · ')} tokens</span>}
      </footer>
    </article>
  );
}
