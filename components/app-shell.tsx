"use client";

import Link from "next/link";
import {
  usePathname,
  useRouter,
} from "next/navigation";

import { signOut } from "firebase/auth";

import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import {
  BarChart3,
  CalendarDays,
  CarFront,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";

import {
  useEffect,
  useState,
} from "react";

import { useFirebaseAuth } from "./firebase-provider";

import { getFirebaseClient } from "@/lib/firebase/client";

const navigation = [
  {
    href: "/",
    label: "Overview",
    icon: LayoutDashboard,
  },
  {
    href: "/rentals",
    label: "Bookings",
    icon: CalendarDays,
  },
  {
    href: "/customers",
    label: "Customers",
    icon: UsersRound,
  },
  {
    href: "/vehicles",
    label: "Fleet",
    icon: CarFront,
  },
  {
    /* Recording what the fleet costs to run is operational
       work, so it sits outside the administrator-only
       Finance screen. */
    href: "/expenses",
    label: "Expenses",
    icon: ReceiptText,
  },
  {
    href: "/finance",
    label: "Finance",
    icon: BarChart3,
    admin: true,
  },
  {
    href: "/staff",
    label: "Staff",
    icon: UserRoundCheck,
    admin: true,
    countsPendingStaff: true,
  },
];

/*
 * More than this and the badge says "lots", which is all an
 * administrator needs to know before opening the screen.
 */
const PENDING_BADGE_CEILING = 99;

type AppShellProps = {
  children: React.ReactNode;
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
};

export function AppShell({
  children,
  title,
  eyebrow,
  action,
}: AppShellProps) {
  const {
    user,
    role,
    status,
  } = useFirebaseAuth();

  const router = useRouter();
  const pathname = usePathname();

  /*
   * The menu records the route it was opened on so a route
   * change closes it without an extra render pass.
   */
  const [menu, setMenu] =
    useState<{
      open: boolean;
      path: string;
    }>({
      open: false,
      path: pathname,
    });

  const open =
    menu.open &&
    menu.path === pathname;

  function setOpen(
    next: boolean | ((value: boolean) => boolean),
  ) {
    setMenu((current) => {
      const currentlyOpen =
        current.open &&
        current.path === pathname;

      return {
        open:
          typeof next === "function"
            ? next(currentlyOpen)
            : next,
        path: pathname,
      };
    });
  }

  const [loggingOut, setLoggingOut] =
    useState(false);

  /*
   * Nothing emails an administrator when somebody registers,
   * so the count beside Staff is what surfaces a waiting
   * request from anywhere in the application. It is a live
   * listener rather than a read on mount: an account that
   * registers while the workspace is open should appear
   * without a refresh.
   */
  const [pendingStaff, setPendingStaff] =
    useState(0);

  useEffect(() => {
    if (role !== "admin") {
      return;
    }

    let unsubscribe:
      | (() => void)
      | undefined;

    try {
      const { db } = getFirebaseClient();

      unsubscribe = onSnapshot(
        query(
          collection(db, "users"),
          where("status", "==", "pending"),
          limit(PENDING_BADGE_CEILING + 1),
        ),

        (snapshot) =>
          setPendingStaff(snapshot.size),

        /*
         * A badge is not worth breaking the shell over: a
         * refused or failed read simply shows no count.
         */
        () => setPendingStaff(0),
      );
    } catch {
      // Firebase is unconfigured; the shell reports that itself.
    }

    return () => unsubscribe?.();
  }, [role]);

  /*
   * Prevent the mobile menu from scrolling
   * the page underneath it.
   */
  useEffect(() => {
    if (!open) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  async function logout() {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    try {
      await signOut(
        getFirebaseClient().auth,
      );

      /*
       * Replace rather than push so the protected
       * dashboard cannot remain in browser history.
       */
      router.replace("/login");
    } catch (error) {
      console.error(
        "Sign out failed:",
        error,
      );

      /*
       * Even if Firebase sign-out reports an
       * unexpected client-side error, don't leave
       * the user trapped on the application shell.
       */
      setLoggingOut(false);
    }
  }

  const items =
    navigation.filter(
      (item) =>
        !item.admin ||
        role === "admin",
    );

  /*
   * Don't render the application shell for an
   * unresolved authentication state.
   *
   * This prevents a brief dashboard flash while
   * FirebaseProvider is still resolving the user.
   */
  if (
    status === "loading" ||
    status === "config-error"
  ) {
    return null;
  }

  return (
    <div className="app-frame">
      {/*
       * Desktop / tablet sidebar
       */}
      <aside
        className={`app-sidebar ${
          open ? "is-open" : ""
        }`}
        aria-label="Main navigation"
      >
        <div className="brand-lockup">
          <img
            src="/brand/advance-auto-rentals-logo.png"
            alt="Advance Auto Rental & Repairs"
            className="sidebar-brand-logo"
          />
        </div>

        <nav className="sidebar-nav">
          {items.map(
            ({
              href,
              label,
              icon: Icon,
              countsPendingStaff,
            }) => {
              const waiting =
                countsPendingStaff
                  ? pendingStaff
                  : 0;

              return (
                <Link
                  className={
                    pathname === href
                      ? "active"
                      : ""
                  }
                  href={href}
                  onClick={() =>
                    setOpen(false)
                  }
                  key={href}
                  aria-current={
                    pathname === href
                      ? "page"
                      : undefined
                  }
                >
                  <Icon
                    size={19}
                    strokeWidth={2.1}
                  />

                  <span>
                    {label}
                  </span>

                  {waiting > 0 && (
                    <b
                      className="nav-count"
                      aria-label={`${waiting} awaiting approval`}
                    >
                      {waiting >
                      PENDING_BADGE_CEILING
                        ? `${PENDING_BADGE_CEILING}+`
                        : waiting}
                    </b>
                  )}
                </Link>
              );
            },
          )}
        </nav>

        <div className="profile">
          <div className="avatar">
            {(
              user?.email?.[0] ??
              "A"
            ).toUpperCase()}
          </div>

          <div className="profile-copy">
            <strong>
              {user?.email
                ?.split("@")[0] ??
                "Staff"}
            </strong>

            <small>
              {role === "admin"
                ? "Administrator"
                : "Operations"}
            </small>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={() =>
              void logout()
            }
            disabled={loggingOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut
              size={18}
            />
          </button>
        </div>
      </aside>

      {/*
       * Mobile/tablet backdrop
       */}
      {open && (
        <button
          className="nav-backdrop"
          type="button"
          aria-label="Close menu"
          onClick={() =>
            setOpen(false)
          }
        />
      )}

      <main className="app-main">
        <header className="app-header">
          <button
            className="mobile-menu icon-button"
            type="button"
            onClick={() =>
              setOpen(
                (value) => !value,
              )
            }
            aria-label={
              open
                ? "Close menu"
                : "Open menu"
            }
            aria-expanded={open}
          >
            {open ? (
              <X size={20} />
            ) : (
              <Menu size={20} />
            )}
          </button>

          <div className="app-header-title">
            {eyebrow && (
              <p className="page-kicker">
                {eyebrow}
              </p>
            )}

            <h1>{title}</h1>
          </div>

          {action && (
            <div className="header-action">
              {action}
            </div>
          )}
        </header>

        {children}
      </main>

      {/*
       * Mobile bottom navigation.
       *
       * Finance deliberately remains accessible from
       * the menu rather than taking one of the four
       * bottom-navigation slots.
       */}
      <nav
        className="mobile-nav"
        aria-label="Mobile navigation"
      >
        {items
          .slice(0, 4)
          .map(
            ({
              href,
              label,
              icon: Icon,
            }) => (
              <Link
                href={href}
                className={
                  pathname === href
                    ? "active"
                    : ""
                }
                key={href}
                aria-current={
                  pathname === href
                    ? "page"
                    : undefined
                }
              >
                <Icon size={19} />

                <span>
                  {label}
                </span>
              </Link>
            ),
          )}
      </nav>
    </div>
  );
}