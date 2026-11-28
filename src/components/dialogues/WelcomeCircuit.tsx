import React from 'react';

export function WelcomeCircuit({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 600 244"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="#0758d6" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M150 104V31H303M150 140v71h153M303 206v5M303 15v40M303 103v45M303 120h115" />
        <circle cx="150" cy="122" r="18" fill="#f6fbff" />
        <path d="M144 115h12m-6-6v12m-6 10h12" strokeWidth="2" />
      </g>
      <g fill="none" stroke="#182138" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M303 55l10 5-20 8 20 8-20 8 20 8-10 5v6m0 45l10 5-20 8 20 8-20 8 20 8-10 5v16m0 5v13m-16 0h32m-26 6h20m-15 6h10" />
        <circle cx="303" cy="11" r="5" fill="#f6fbff" />
        <circle cx="423" cy="120" r="5" fill="#f6fbff" />
      </g>
      <g fill="#182138">
        <circle cx="303" cy="31" r="4.5" />
        <circle cx="303" cy="120" r="4.5" />
        <circle cx="303" cy="211" r="4.5" />
      </g>
      <g fill="#b52127" fontFamily="Arial, sans-serif" fontSize="17">
        <text x="317" y="16">
          VCC
        </text>
        <text x="325" y="64">
          R1
          <tspan x="325" dy="18">
            10k
          </tspan>
        </text>
        <text x="325" y="155">
          R2
          <tspan x="325" dy="18">
            10k
          </tspan>
        </text>
        <text x="177" y="118">
          V1
          <tspan x="177" dy="18">
            12V
          </tspan>
        </text>
        <text x="435" y="113">
          OUT
        </text>
      </g>
    </svg>
  );
}
