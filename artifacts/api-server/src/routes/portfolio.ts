import { Router, type IRouter } from "express";
import {
  AdvanceApplicationParams,
  CreateApplicationBody,
  CreateClientBody,
  DisburseLoanParams,
  GetPortfolioOverviewQueryParams,
  RecordCollectionBody,
} from "@workspace/api-zod";

type ApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "declined";

type LoanStatus = "active" | "overdue" | "completed";

interface Client {
  id: string;
  displayName: string;
  externalRef: string;
  location: string;
  createdAt: string;
}

interface Application {
  id: string;
  clientId: string;
  clientName: string;
  productName: string;
  requestedAmount: number;
  status: ApplicationStatus;
  createdAt: string;
}

interface Loan {
  id: string;
  clientName: string;
  productName: string;
  principalAmount: number;
  outstandingPrincipal: number;
  status: LoanStatus;
  dueDate: string;
}

interface Product {
  id: string;
  name: string;
  code: string;
  termWeeks: number;
  serviceCharge: number;
}

interface Collection {
  id: string;
  clientName: string;
  amount: number;
  method: "cash" | "mobile_money";
  status: "posted";
  recordedAt: string;
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  timestamp: string;
}

const now = new Date();
const isoDaysAgo = (days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString();
const isoDaysFromNow = (days: number) =>
  new Date(now.getTime() + days * 86_400_000).toISOString();

const products: Product[] = [
  {
    id: "prod-growth",
    name: "Growth loan",
    code: "GROWTH-12",
    termWeeks: 12,
    serviceCharge: 8,
  },
  {
    id: "prod-market",
    name: "Market working capital",
    code: "MARKET-08",
    termWeeks: 8,
    serviceCharge: 6,
  },
];

const clients: Client[] = [
  {
    id: "client-001",
    displayName: "Amina Namatovu",
    externalRef: "UPF-1048",
    location: "Kampala Central",
    createdAt: isoDaysAgo(42),
  },
  {
    id: "client-002",
    displayName: "Moses Okello",
    externalRef: "UPF-1057",
    location: "Nakawa",
    createdAt: isoDaysAgo(30),
  },
  {
    id: "client-003",
    displayName: "Sarah Atim",
    externalRef: "UPF-1062",
    location: "Ntinda",
    createdAt: isoDaysAgo(18),
  },
  {
    id: "client-004",
    displayName: "Joseph Kato",
    externalRef: "UPF-1071",
    location: "Rubaga",
    createdAt: isoDaysAgo(9),
  },
];

const applications: Application[] = [
  {
    id: "APP-2481",
    clientId: "client-001",
    clientName: "Amina Namatovu",
    productName: "Growth loan",
    requestedAmount: 1_800_000,
    status: "under_review",
    createdAt: isoDaysAgo(1),
  },
  {
    id: "APP-2476",
    clientId: "client-002",
    clientName: "Moses Okello",
    productName: "Market working capital",
    requestedAmount: 950_000,
    status: "submitted",
    createdAt: isoDaysAgo(2),
  },
  {
    id: "APP-2468",
    clientId: "client-003",
    clientName: "Sarah Atim",
    productName: "Growth loan",
    requestedAmount: 2_500_000,
    status: "approved",
    createdAt: isoDaysAgo(5),
  },
];

const loans: Loan[] = [
  {
    id: "LOAN-9017",
    clientName: "Grace Nakato",
    productName: "Growth loan",
    principalAmount: 2_000_000,
    outstandingPrincipal: 1_250_000,
    status: "active",
    dueDate: isoDaysFromNow(12),
  },
  {
    id: "LOAN-9012",
    clientName: "David Ssemanda",
    productName: "Market working capital",
    principalAmount: 1_200_000,
    outstandingPrincipal: 460_000,
    status: "active",
    dueDate: isoDaysFromNow(4),
  },
  {
    id: "LOAN-9004",
    clientName: "Rebecca Namuli",
    productName: "Growth loan",
    principalAmount: 1_500_000,
    outstandingPrincipal: 0,
    status: "completed",
    dueDate: isoDaysAgo(3),
  },
];

const collections: Collection[] = [
  {
    id: "COL-5291",
    clientName: "Grace Nakato",
    amount: 250_000,
    method: "mobile_money",
    status: "posted",
    recordedAt: isoDaysAgo(0),
  },
  {
    id: "COL-5287",
    clientName: "David Ssemanda",
    amount: 150_000,
    method: "cash",
    status: "posted",
    recordedAt: isoDaysAgo(1),
  },
];

const activity: ActivityItem[] = [
  {
    id: "activity-1",
    type: "collection",
    title: "Collection posted",
    detail: "Grace Nakato · 250,000 UGX via mobile money",
    timestamp: isoDaysAgo(0),
  },
  {
    id: "activity-2",
    type: "approval",
    title: "Application approved",
    detail: "Sarah Atim · Growth loan · 2,500,000 UGX",
    timestamp: isoDaysAgo(1),
  },
  {
    id: "activity-3",
    type: "review",
    title: "Application moved to review",
    detail: "Amina Namatovu · Growth loan",
    timestamp: isoDaysAgo(1),
  },
  {
    id: "activity-4",
    type: "client",
    title: "New client added",
    detail: "Joseph Kato · Rubaga",
    timestamp: isoDaysAgo(9),
  },
];

const money = (value: number) => Math.max(0, Math.round(value));

function buildOverview() {
  const totalDisbursed = loans.reduce(
    (sum, loan) => sum + loan.principalAmount,
    0,
  );
  const outstandingPrincipal = loans.reduce(
    (sum, loan) => sum + loan.outstandingPrincipal,
    0,
  );
  const collectedThisMonth = collections.reduce(
    (sum, collection) => sum + collection.amount,
    0,
  );
  const activeLoans = loans.filter((loan) => loan.status === "active").length;

  return {
    metrics: {
      totalDisbursed,
      outstandingPrincipal,
      collectedThisMonth,
      activeLoans,
      atRisk: 460_000,
      repaymentRate: 94.6,
    },
    applications,
    loans,
    clients,
    products,
  };
}

function appendActivity(
  type: string,
  title: string,
  detail: string,
): ActivityItem {
  const item = {
    id: `activity-${Date.now()}`,
    type,
    title,
    detail,
    timestamp: new Date().toISOString(),
  };
  activity.unshift(item);
  return item;
}

function nextApplicationStatus(status: ApplicationStatus): ApplicationStatus {
  const transitions: Record<ApplicationStatus, ApplicationStatus> = {
    draft: "submitted",
    submitted: "under_review",
    under_review: "approved",
    approved: "approved",
    declined: "declined",
  };
  return transitions[status];
}

const router: IRouter = Router();

router.get("/portfolio/overview", (req, res) => {
  const parsed = GetPortfolioOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid portfolio query." });
    return;
  }
  res.json(buildOverview());
});

router.get("/portfolio/activity", (_req, res) => {
  res.json(activity.slice(0, 12));
});

router.post("/clients", (req, res) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a name, reference, and location." });
    return;
  }
  const client: Client = {
    id: `client-${String(clients.length + 1).padStart(3, "0")}`,
    ...parsed.data,
    createdAt: new Date().toISOString(),
  };
  clients.unshift(client);
  appendActivity(
    "client",
    "New client added",
    `${client.displayName} · ${client.location}`,
  );
  res.status(201).json(client);
});

router.post("/applications", (req, res) => {
  const parsed = CreateApplicationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a client, product, and amount." });
    return;
  }
  const client = clients.find((item) => item.id === parsed.data.clientId);
  const product = products.find((item) => item.id === parsed.data.productId);
  if (!client || !product) {
    res.status(404).json({ error: "Client or product not found." });
    return;
  }
  const application: Application = {
    id: `APP-${2481 + applications.length}`,
    clientId: client.id,
    clientName: client.displayName,
    productName: product.name,
    requestedAmount: money(parsed.data.requestedAmount),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  applications.unshift(application);
  appendActivity(
    "application",
    "Draft application created",
    `${client.displayName} · ${product.name} · ${money(application.requestedAmount).toLocaleString()} UGX`,
  );
  res.status(201).json(application);
});

router.post("/applications/:id/advance", (req, res) => {
  const parsed = AdvanceApplicationParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid application." });
    return;
  }
  const application = applications.find((item) => item.id === parsed.data.id);
  if (!application) {
    res.status(404).json({ error: "Application not found." });
    return;
  }
  const nextStatus = nextApplicationStatus(application.status);
  application.status = nextStatus;
  appendActivity(
    "application",
    `Application ${nextStatus.replace("_", " ")}`,
    `${application.clientName} · ${application.productName}`,
  );
  res.json(application);
});

router.post("/loans/:id/disburse", (req, res) => {
  const parsed = DisburseLoanParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid loan." });
    return;
  }
  const application = applications.find((item) => item.id === parsed.data.id);
  if (!application) {
    res.status(404).json({ error: "Approved application not found." });
    return;
  }
  application.status = "approved";
  const loan: Loan = {
    id: `LOAN-${9000 + loans.length + 1}`,
    clientName: application.clientName,
    productName: application.productName,
    principalAmount: application.requestedAmount,
    outstandingPrincipal: application.requestedAmount,
    status: "active",
    dueDate: isoDaysFromNow(84),
  };
  loans.unshift(loan);
  appendActivity(
    "disbursement",
    "Loan disbursed",
    `${loan.clientName} · ${money(loan.principalAmount).toLocaleString()} UGX`,
  );
  res.json(loan);
});

router.post("/collections", (req, res) => {
  const parsed = RecordCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a loan, amount, and payment method." });
    return;
  }
  const loan = loans.find((item) => item.id === parsed.data.loanId);
  if (!loan) {
    res.status(404).json({ error: "Loan not found." });
    return;
  }
  const amount = money(parsed.data.amount);
  loan.outstandingPrincipal = money(loan.outstandingPrincipal - amount);
  if (loan.outstandingPrincipal === 0) loan.status = "completed";
  const collection: Collection = {
    id: `COL-${5291 + collections.length}`,
    clientName: loan.clientName,
    amount,
    method: parsed.data.method,
    status: "posted",
    recordedAt: new Date().toISOString(),
  };
  collections.unshift(collection);
  appendActivity(
    "collection",
    "Collection posted",
    `${loan.clientName} · ${amount.toLocaleString()} UGX via ${parsed.data.method.replace("_", " ")}`,
  );
  res.status(201).json(collection);
});

export default router;