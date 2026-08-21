"use client";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import {
  Search,
  UserRound,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { AppShell } from "./app-shell";

import { getFirebaseClient } from "@/lib/firebase/client";
import {
  firebaseErrorMessage,
  formatDate,
} from "@/lib/presentation";

type Customer = {
  id: string;
  fullName: string;
  telephone: string;
  email: string | null;
  address: string | null;
  licenceNumber: string;
  licenceCountry: string;
  licenceExpiresAt: string | null;
};

export function CustomerDirectory() {
  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [search, setSearch] =
    useState("");

  const [error, setError] =
    useState<string>();

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadCustomers() {
      try {
        const snapshot =
          await getDocs(
            query(
              collection(
                getFirebaseClient().db,
                "customers",
              ),
              orderBy("fullName"),
              limit(500),
            ),
          );

        if (!mounted) {
          return;
        }

        setCustomers(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            fullName:
              doc.get("fullName"),
            telephone:
              doc.get("telephone"),
            email:
              doc.get("email") ?? null,
            address:
              doc.get("address") ?? null,
            licenceNumber:
              doc.get("licenceNumber"),
            licenceCountry:
              doc.get("licenceCountry"),
            licenceExpiresAt:
              doc.get(
                "licenceExpiresAt",
              ) ?? null,
          })),
        );
      } catch (cause) {
        if (mounted) {
          setError(
            firebaseErrorMessage(cause),
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredCustomers =
    useMemo(() => {
      const needle =
        search.trim().toLowerCase();

      if (!needle) {
        return customers;
      }

      return customers.filter(
        (customer) =>
          [
            customer.fullName,
            customer.telephone,
            customer.email,
            customer.licenceNumber,
          ]
            .filter(Boolean)
            .some((value) =>
              String(value)
                .toLowerCase()
                .includes(needle),
            ),
      );
    }, [customers, search]);

  return (
    <AppShell
      title="Customers"
      eyebrow="Customer records"
    >
      {error && (
        <div
          className="alert alert-error"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className="customer-surface surface">
        <div className="surface-toolbar">
          <div className="search-box">
            <Search size={17} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search name, telephone or licence"
            />
          </div>

          <span className="customer-count">
            {filteredCustomers.length} customer
            {filteredCustomers.length === 1
              ? ""
              : "s"}
          </span>
        </div>

        {loading ? (
          <div className="inline-empty">
            Loading customer records...
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-illustration">
              <UserRound size={23} />
            </div>

            <h2>
              No customer records
            </h2>

            <p>
              Create a customer from the
              Bookings screen. Saved customers
              will appear here.
            </p>
          </div>
        ) : (
          <div className="table-wrap customer-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Licence</th>
                  <th>Expires</th>
                  <th>Address</th>
                </tr>
              </thead>

              <tbody>
                {filteredCustomers.map(
                  (customer) => (
                    <tr key={customer.id}>
                      <td>
                        <strong>
                          {customer.fullName}
                        </strong>

                        <span>
                          {customer.email ||
                            "No email recorded"}
                        </span>
                      </td>

                      <td>
                        <strong>
                          {customer.telephone}
                        </strong>
                      </td>

                      <td>
                        <strong>
                          {customer.licenceNumber}
                        </strong>

                        <span>
                          {customer.licenceCountry}
                        </span>
                      </td>

                      <td>
                        {formatDate(
                          customer.licenceExpiresAt,
                        )}
                      </td>

                      <td>
                        {customer.address ||
                          "Not recorded"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
