interface BranchOption { id: string; code: string; name: string; }

interface Props {
  branches: ReadonlyArray<BranchOption>;
  selectedBranchId?: string;
  onSelect: (branchId: string) => void;
}

export function BranchSelector({ branches, selectedBranchId, onSelect }: Props) {
  if (branches.length <= 1) return null;
  return (
    <label className="branch-selector">
      <span className="sr-only">Active branch</span>
      <select aria-label="Active branch" value={selectedBranchId ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
      </select>
    </label>
  );
}