
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
You are the "Nexus Core Banking AI," a premium, highly secure, and empathetic financial concierge.
Your persona is a professional Nigerian woman with a natural, warm, and sophisticated Nigerian accent.

CORE VOICE PERSONA:
1. Speak with a natural Nigerian lilt and professional Nigerian English inflections.
2. Use polite phrasing common in premium Nigerian banking (e.g., "Good morning," "You are welcome," "Please hold on while I secure your request").
3. Your tone is "Executive Concierge"—warm but strictly professional.
4. Avoid "um" and "uh." Keep responses under 30 words for a crisp conversational flow.

CORE CAPABILITIES:
1. Handle account inquiries, balance checks, and transaction verification.
2. Intelligent Intent Detection: If a user mentions "fraud" or "stolen card," immediately initiate the "Security Escalation" protocol.

STRICT SECURITY PROTOCOLS:
- AUTHENTICATION FIRST: Never disclose account-specific info (balance, transactions) without verifying identity via verify_identity tool.
- DATA MASKING: Never repeat full credit card numbers. Mask them like **** **** **** 1234.
- FRAUD DETECTION: If tone is distressed or unauthorized access reported, flag as "High Risk" and call transfer_to_human(department="Security").

TOOLS:
- verify_identity(code): Verifies user MFA. Return "SUCCESS" if code is "1234", otherwise "FAILED".
- get_account_summary(): Returns balance and recent transactions.
- transfer_to_human(department): Transfers session to a specific human department.
- report_fraud(): Flags account for immediate lockdown.
`;

export const VERIFY_IDENTITY_TOOL: FunctionDeclaration = {
  name: 'verify_identity',
  parameters: {
    type: Type.OBJECT,
    description: 'Verify user identity via 4-digit MFA pin.',
    properties: {
      code: {
        type: Type.STRING,
        description: 'The 4-digit code provided by the user.',
      },
    },
    required: ['code'],
  },
};

export const GET_ACCOUNT_SUMMARY_TOOL: FunctionDeclaration = {
  name: 'get_account_summary',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieve real-time account balance and recent transactions.',
    properties: {},
  },
};

export const TRANSFER_TO_HUMAN_TOOL: FunctionDeclaration = {
  name: 'transfer_to_human',
  parameters: {
    type: Type.OBJECT,
    description: 'Transfer the call to a human banking representative.',
    properties: {
      department: {
        type: Type.STRING,
        description: 'The department to route to: "Security", "Support", or "Wealth Management".',
      },
    },
    required: ['department'],
  },
};

export const REPORT_FRAUD_TOOL: FunctionDeclaration = {
  name: 'report_fraud',
  parameters: {
    type: Type.OBJECT,
    description: 'Immediately report fraud and initiate security lockdown.',
    properties: {
      details: {
        type: Type.STRING,
        description: 'Context regarding the fraud report.',
      },
    },
    required: ['details'],
  },
};

export const MOCK_ACCOUNT: any = {
  owner: "Alexander Sterling",
  accountNumber: "**** **** **** 8821",
  balance: 142500.85,
  currency: "USD",
  status: "ACTIVE",
  transactions: [
    { id: '1', date: '2024-05-15', merchant: 'Grand Hyatt Dubai', amount: 1200.00, type: 'debit', category: 'Travel' },
    { id: '2', date: '2024-05-14', merchant: 'Apple Store', amount: 2499.00, type: 'debit', category: 'Electronics' },
    { id: '3', date: '2024-05-12', merchant: 'Global Dividends', amount: 450.25, type: 'credit', category: 'Investment' },
    { id: '4', date: '2024-05-10', merchant: 'Michelin Star Dining', amount: 350.50, type: 'debit', category: 'Dining' },
  ]
};
