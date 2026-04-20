export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="nx-admin">{children}</div>;
}
